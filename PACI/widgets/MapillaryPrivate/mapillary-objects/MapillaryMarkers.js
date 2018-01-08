/* globals define */

define([
	'dojo/_base/declare',
	'dojo/_base/lang',

	'dojo/promise/all',
	'dijit/form/CheckBox',
	'dojo/dom',
	'dojo/on',
	'dojo/topic',

	'../mapillaryUtils',

	'esri/geometry/Extent',
	'esri/SpatialReference',
	'esri/Color',
	'esri/geometry/Point',
	'esri/tasks/query',
	'esri/geometry/webMercatorUtils',
	'esri/graphic',
	'esri/symbols/SimpleLineSymbol',
	'esri/symbols/SimpleMarkerSymbol',
	'esri/symbols/PictureMarkerSymbol'
], function (declare, lang, all, CheckBox, dom, on, topic,
             mapillaryUtils,
             Extent, SpatialReference, Color, Point, Query, webMercatorUtils, Graphic, SimpleLineSymbol, SimpleMarkerSymbol, PictureMarkerSymbol) {

	function shadeColor(color, percent) {
		var f = parseInt(color.slice(1), 16), t = percent < 0 ? 0 : 255, p = percent < 0 ? percent * -1 : percent,
			R = f >> 16, G = f >> 8 & 0x00FF, B = f & 0x0000FF;
		return "#" + (0x1000000 + (Math.round((t - R) * p) + R) * 0x10000 + (Math.round((t - G) * p) + G) * 0x100 + (Math.round((t - B) * p) + B)).toString(16).slice(1);
	}

	/**
	 * MapillaryObjects
	 * @class MapillaryObjects
	 */
	return declare(null, {
		hoverColor: '#f80',
		/**
		 * Constructor
		 * @param viewer
		 * @param map
		 */
		constructor: function (viewer, map) {
			this.map = map;
			this.markerComponent = viewer.getComponent('marker');
			this.viewer = viewer;
			this.editing = false;
			this.node = false;
			this.editOpen = false;
			this._query = {};
			this._events = [];
			this._layerEvents = {};
			this._layerColors = {};
			this._layers = [];

			function initCallback(r) {
				this.init()
			}

			this.markerComponent
				.activated$
				.filter(function (activated) {
					return activated
				})
				.first()
				.subscribe(initCallback.bind(this))
		},

		/**
		 * Init
		 */
		init: function () {
			this._layers = this.map.graphicsLayerIds.map(lang.hitch(this, function (l) {
				return this.map.getLayer(l)
			}));

			this._addMapillaryHoverEvent();
			//this._addMapillaryHoverIndicatorMarker();

			// Add layer event handlers
			this._layers.forEach(this._addLayerEvents.bind(this));
			// Listen for new layers
			this.map.on('layer-add', function (add) {
				this._layerVisibilityChangeCallback(add.layer, true);
				this._addLayerEvents(add.layer);
			}.bind(this));
			// Listen for removing layers
			this.map.on('layer-remove', function (remove) {
				this._layerVisibilityChangeCallback(remove.layer, false);
				this._removeLayerEvents(remove.layer);
			}.bind(this));

			// Add Viewer event handlers
			this._events.push(this.viewer.on(mapillaryUtils.Mapillary.Viewer.click, lang.hitch(this, this._onViewerMouseClick)));
			this._events.push(this.viewer.on('nodechanged', this._onNodeChangedCallback.bind(this)));
			this._events.push(topic.subscribe('MapillaryEditOpen', this._mapillaryEditOpen.bind(this)));
			this._events.push(topic.subscribe('MapillaryEditClose', this._mapillaryEditClose.bind(this)));
			this._events.push(topic.subscribe('MapillaryEditActive', this._mapillaryEditActive.bind(this)));
			this._events.push(topic.subscribe('MapillaryEditDeactive', this._mapillaryEditDeactive.bind(this)));
			//this._events.push(topic.subscribe('MapillaryEditMove', this._graphicMoveCallback.bind(this)));

			// Add Map event handlers
			this._events.push(this.map.on('mouse-move', this._mapMouseMoveCallback.bind(this)));
			this._events.push(this.map.on('click', this._mapClickCallback.bind(this)));

		},

		/**
		 * Destroy
		 */
		destroy: function () {
			this._events.forEach(function (e) {
				e && typeof e.remove === 'function' && e.remove();
			});
		},

		/**
		 * Create Mapillary Hover Indicator Marker
		 * @private
		 */
		_addMapillaryHoverIndicatorMarker: function () {
			// Show a flat circle marker in the viewer when hovering the ground in the viewer
			var indicatorMarker = null;
			var indicatorMarkerId = "indicator-id";
			var dragging = false;
			var markerComponent = this.markerComponent;
			var lastPos = null;
			var setIndicator = function (latLon) {
				indicatorMarker = new mapillaryUtils.Mapillary.MarkerComponent.CircleMarker(
					indicatorMarkerId,
					latLon,
					{color: '#0f0'});

				markerComponent.add([indicatorMarker]);
			};

			var removeIndicator = function () {
				if (!!indicatorMarker && markerComponent.has(indicatorMarker.id)) {
					markerComponent.remove([indicatorMarker.id]);
					indicatorMarker = null;
				}
			};

			var moveIndicator = function (latLon) {
				if (dragging) {
					return;
				}

				if (!latLon) {
					removeIndicator();
				} else {
					setIndicator({lat: latLon.lat, lon: latLon.lon});
				}
			};

			var onViewerMouseEvent = function (event) {
				lastPos = event.pixelPoint;
				moveIndicator(event.latLon);
			};

			// Listen to viewer mouse events
			this._events.push(this.viewer.on(mapillaryUtils.Mapillary.Viewer.mouseup, onViewerMouseEvent));
			this._events.push(this.viewer.on('mousemove', onViewerMouseEvent));
			this._events.push(this.viewer.on(mapillaryUtils.Mapillary.Viewer.mousedown, onViewerMouseEvent));
		},

		/**
		 * Add Mapillary Hover Event
		 * @private
		 */
		_addMapillaryHoverEvent: function () {
			// Change color of hovered marker
			var markerComponent = this.markerComponent;
			var defaultColor = null;
			var lastPos = null;
			var draggedId = null;
			var hoveredMarker = null;
			var dragTimer,
				dragTime = 0,
				updateHoverState = lang.hitch(this, function (hoveredId) {
					// Do not update when dragging to keep hovered color
					if (draggedId !== null) {
						return;
					}
					/* Hover color change
					if (hoveredId === null) {
						if (hoveredMarker !== null) {
							defaultColor = this.getLayerColor(hoveredMarker._layer.id);
							markerComponent.add([
								this.createFeatureMarker(hoveredMarker._feature, {
									lat: hoveredMarker.latLon.lat,
									lon: hoveredMarker.latLon.lon,
									interactive: true,
									color: defaultColor
								})
							]);
							hoveredMarker = null;
							defaultColor = null;
						}
					} else {
						if (hoveredMarker === null) {
							hoveredMarker = this.createFeatureMarker(markerComponent.get(hoveredId)._feature, {
								lat: markerComponent.get(hoveredId).latLon.lat,
								lon: markerComponent.get(hoveredId).latLon.lon,
								interactive: true,
								color: this.hoverColor
							});
							markerComponent.add([hoveredMarker]);
						} else if (hoveredMarker.id !== hoveredId) {
							var regularMarker = this.createFeatureMarker(hoveredMarker._feature, {
								lat: hoveredMarker.latLon.lat,
								lon: hoveredMarker.latLon.lon,
								interactive: false,
								color: this.getLayerColor(hoveredMarker._layer.id)
							});
							hoveredMarker = this.createFeatureMarker(markerComponent.get(hoveredId)._feature, {
								lat: markerComponent.get(hoveredId).latLon.lat,
								lon: markerComponent.get(hoveredId).latLon.lon,
								interactive: true,
								color: this.hoverColor
							});
							markerComponent.add([regularMarker, hoveredMarker]);
						}
					}*/
				}),
				_dragEnd = function (e) {
					clearInterval(dragTimer);
					console.log('MapillaryMarkers::dragend', e.marker, dragTime, lastPos);
					draggedId = null;
					if (dragTime > 0 && lastPos !== null) {
						markerComponent.getMarkerIdAt(lastPos).then(updateHoverState);
						topic.publish('MapillaryViewerEdit', e.marker);
					} else if (e.marker) {
						topic.publish('MapillaryViewerSelect', e.marker);
						updateHoverState(null);
					} else {
						markerComponent.getMarkerIdAt(lastPos).then(lang.hitch(this, function (id) {
							if (id) {
								topic.publish('MapillaryViewerSelect', markerComponent.get(id));
								updateHoverState(null);
							}
						}))
					}
					dragTime = 0;
				};


			/*this._events.push(this.viewer.on('mousedown', function(e) {
				markerComponent.getMarkerIdAt(lastPos).then(function(marker) {
					console.log(marker);
				});
			}));*/

			// Store last position to uproject on drag end
			this._events.push(this.viewer.on("mousemove", function (e) {
				lastPos = e.pixelPoint;
				markerComponent.getMarkerIdAt(e.pixelPoint).then(updateHoverState);
			}));

			this._events.push(this.viewer.on("mouseout", function (e) {
				lastPos = null;
			}));

			this._events.push(markerComponent.on("dragstart", function (e) {
				console.log('MapillaryMarkers::dragstart', e);
				dragTimer = setInterval(function () {
					dragTime += 100;
				}, 100);
				draggedId = e.marker.id;
			}));
			this._events.push(this.viewer.on("click", _dragEnd));
			this._events.push(markerComponent.on("dragend", _dragEnd));
		},

		/**
		 * Add Layer
		 * @param layer
		 * @private
		 */
		_addLayer: function (layer) {
			this._layers.push(layer);
			return this;
		},

		/**
		 * Remove Layer
		 * @param layer
		 * @private
		 */
		_removeLayer: function (layer) {
			var removeIndex = -1,
				allMarkers = this.markerComponent.getAll(),
				_getLayerMarkers = function (layerId) {
					return allMarkers.filter(function (marker) {
						return marker && marker._layer && marker._layer.id === layerId;
					});
				},
				layerMarkers = _getLayerMarkers(layer.id);

			this._layers.forEach(function (_layer, i) {
				if (layer.id === _layer.id)
					removeIndex = i;
			}.bind(this));

			if (removeIndex > -1)
				this._layers.splice(removeIndex, 1);

			this.markerComponent.remove(layerMarkers.map(function (marker) {
				return marker._id;
			}));

			return this;
		},

		/**
		 * Add Layer Events
		 * @param layer
		 * @private
		 */
		_addLayerEvents: function (layer) {
			if (this._layerEvents[layer.id])
				return;
			this._layerEvents[layer.id] = [
				layer.on('visibility-change', lang.hitch(this, function (e) {
					this._layerVisibilityChangeCallback(layer, e.visible);
				})),
				layer.on('edits-complete', lang.hitch(this, this._graphicNodeEditCompleteCallback))
			];
		},

		/**
		 * Remove Layer Events
		 * @param layer
		 * @private
		 */
		_removeLayerEvents: function (layer) {
			if (this._layerEvents[layer.id])
				this._layerEvents[layer.id].forEach(function (e) {
					e && typeof e.remove === 'function' && e.remove();
				});
			this._layerEvents[layer.id] = null;
			delete this._layerEvents[layer.id];
		},

		/**
		 * Get Layer Color
		 * @param layerId
		 * @returns {*}
		 */
		getLayerColor: function (layerId) {
			if (!this._layerColors[layerId])
				this._layerColors[layerId] = '#' + (Math.random() * 0xFFFFFF << 0).toString(16);
			return this._layerColors[layerId];
		},

		/**
		 * Update Markers Around
		 * @param queriedFeatures
		 * @param callback
		 */
		updateMarkersAround: function (queriedFeatures, callback) {
			// FIXME promise helpers
			function reflect(promise) {
				return promise.then(function (v) {
						return {state: 'fulfilled', value: v}
					},
					function (e) {
						return {state: 'rejected', error: e}
					})
			}

			function settle(promises) {
				var actualPromises = promises.filter(function (p) {
					if (!!p) return p
				});
				if (actualPromises) {
					return all(actualPromises.map(reflect))
				} else {
					return all([])
				}
			}

			var _markerComponent = this.markerComponent;
			var _this = this;

			console.log('MapillaryObjects::updateMarkersAround', queriedFeatures);
			// Query features (promise-all)
			settle(queriedFeatures)
			// flatten features
				.then(function (v) {
					var features = v
						.map(function (x) {
							return x.value
						})
						.filter(function (l) {
							return l && l.features
						})
						.map(function (l) {
							if (l.features) {
								return l.features
							} else {
								return []
							}
						});
					return [].concat.apply([], features)
				})
				// Process features into markers
				.then(function (data) {
					console.log('MapillaryObjects::updateMarkersAround', data);
					// Process data
					return data.map(lang.hitch(_this, _this.createFeatureMarker))
				})
				// Add Markers to the viewer
				.then(function (markers) {
					markers.forEach(function (m) {
						setTimeout(function () {
							_markerComponent.add([m]);
						}, 0)
					});

					if (callback) {
						callback()
					}
				})
		},

		/**
		 * Create Feature Marker
		 * @param feature
		 * @param options
		 * @private
		 */
		createFeatureMarker: function (feature, options) {
			options = typeof options === 'object' ? options : {};
			if (feature._layer.objectIdField) {
				feature.attributes.OBJECTID = feature.attributes[feature._layer.objectIdField];
			} else if (!feature.attributes.OBJECTID) {
				console.warn('FeatureLayer does not have an OBJECTID. Guessing ID field.');
				for (var i in feature.attributes) {
					if (feature.attributes.hasOwnProperty(i) && feature.attributes[i] && i.toUpperCase() === i) {
						feature.attributes.OBJECTID = feature.attributes[i];
						break;
					}
				}
			}
			var id = feature.attributes.OBJECTID + ':' + feature._layer.id;
			var geometry = feature.geometry.type === 'point' ? feature.geometry : feature.geometry.getExtent().getCenter();
			var lat = options.lat || (geometry && geometry.getLatitude());
			var lon = options.lon || (geometry && geometry.getLongitude());
			var color = this.getLayerColor(feature._layer.id);

			delete options['lat'];
			delete options['lon'];

			var marker = new mapillaryUtils.Mapillary.MarkerComponent.SimpleMarker(
				id,
				{lat: lat, lon: lon},
				lang.mixin({
					color: (this.editing === id) ? shadeColor(color, .5) : (color || '#FFFFFF'),
					opacity: 0.9,
					ballColor: '#FFFFFF',
					ballOpacity: 1,
					radius: 0.7,
					interactive: this.editOpen
				}, options)
			);
			// store layer on marker so that we can sort markers by layer for visibility changes
			marker._feature = feature;
			marker._layer = feature._layer;
			console.log('MapillaryObjects::createFeatureMarker', marker, feature, options);
			return marker;
		},

		/**
		 * Create Spatial Query
		 * @param lat
		 * @param lon
		 * @returns {*}
		 */
		createSpatialQuery: function (lat, lon) {
			var diff = 0.001;
			var extent = new Extent(lon - diff, lat - diff,
				lon + diff, lat + diff,
				new SpatialReference({wkid: 4326}));

			var query = new Query();
			query.geometry = extent;
			return query
		},

		/**
		 * On Mapillary Node Change
		 * @param node
		 * @param callback
		 * @returns {boolean}
		 * @private
		 */
		_onNodeChangedCallback: function (node, callback) {
			if (!node) {
				console.error('No current node in _onNodeChangedCallback');
				return false;
			}
			this.node = node;
			console.log('MapillaryViewer::MapillaryObjects::onNodeChangedCallback', node);
			if (this.node && this._query[node.originalLatLon.lat + '' + node.originalLatLon.lon]) {
				callback && callback(this._query[node.originalLatLon.lat + '' + node.originalLatLon.lon]);
				return;
			}
			var query = this.createSpatialQuery(node.originalLatLon.lat, node.originalLatLon.lon);
			var queriedFeatures = this._layers.map(function(l) {
				if (l.queryFeatures) {
					return l.queryFeatures(query);
				} else {
					return;
				}
			});
			this._query[node.originalLatLon.lat + '' + node.originalLatLon.lon] = queriedFeatures;
			this.updateMarkersAround(queriedFeatures, function () {
				callback && callback(queriedFeatures);
			}.bind(this));

			this.query = query; // Save query for reuse
		},

		/**
		 * Map Click Callback
		 * @param event
		 * @returns {boolean}
		 * @private
		 */
		_mapClickCallback: function (event) {
			if (this.editing) {
				return false
			}
		},

		/**
		 * Map Mouse Move Callback
		 * @param e
		 * @private
		 */
		_mapMouseMoveCallback: function (e) {
			this.mapPoint = e.mapPoint;
		},

		/**
		 * on Viewer Mouse Click
		 * @param e
		 * @private
		 */
		_onViewerMouseClick: function (e) {
			if (!e || !e.target)
				return;

			if (!e.latLon) {
				return;
			}

			this.markerComponent.getMarkerIdAt(e.pixelPoint).then(lang.hitch(this, function (markerId) {
				// Only create a new marker if no interactive markers are hovered
				if (markerId !== null) {
					return;
				}

				setTimeout(lang.hitch(this, function () {
					var pt = new Point(e.latLon.lon, e.latLon.lat, new SpatialReference({'wkid': 4326}));
					topic.publish('MapillaryViewerAdd', {
						geometry: pt
					});
				}, 0));
			}));
		},

		/**
		 * Mapillary Edit Open
		 */
		_mapillaryEditOpen: function () {
			this.editOpen = true;
			this.markerComponent.getAll().forEach(lang.hitch(this, function (marker) {
				console.log(marker);
				this.markerComponent.add([
					this.createFeatureMarker(marker._feature, {
						interactive: true
					})
				]);
			}));
		},

		/**
		 * Mapillary Edit Close
		 */
		_mapillaryEditClose: function () {
			this.editOpen = false;
			this.markerComponent.getAll().forEach(lang.hitch(this, function (marker) {
				this.markerComponent.add([
					this.createFeatureMarker(marker._feature, {
						interactive: false
					})
				])
			}));
		},

		/**
		 * Mapillary Edit Active
		 * @param e
		 * @private
		 */
		_mapillaryEditActive: function (e) {
			if (e.graphic) {
				setTimeout(lang.hitch(this, function () {
					var id = e.graphic.attributes.OBJECTID + ':' + e.graphic._layer.id;
					this.markerComponent.remove([id]);
					this.editing = id;

					var m = this.createFeatureMarker(e.graphic, {
						color: shadeColor(this.getLayerColor(e.graphic._layer.id), .5),
						interactive: true
					});
					this.markerComponent.add([m]);
				}), 0);
			}
		},

		/**
		 * Mapillary Edit Deactive
		 * @param e
		 * @private
		 */
		_mapillaryEditDeactive: function (e) {
			setTimeout(lang.hitch(this, function () {
				console.log('MapillaryViewer::MapillaryObjects::_mapillaryEditDeactive', e);
				var id = e.graphic.attributes.OBJECTID + ':' + e.graphic._layer.id;
				//ignore if marker is deleted
				if (!this.markerComponent.get(id))
					return false;
				this.markerComponent.remove([id]);

				var m = this.createFeatureMarker(e.graphic, {
					color: this.getLayerColor(e.graphic._layer.id),
					interactive: true
				});
				this.markerComponent.add([m]);
				this.editing = false;
			}), 0);
		},

		/**
		 * Graphic Move Callback
		 * @param e
		 * @private
		 */
		_graphicMoveCallback: function (e) {
			setTimeout(lang.hitch(this, function () {
				console.log('MapillaryViewer::MapillaryObjects::_graphicMoveCallback', e);
				var id = e.graphic.attributes.OBJECTID + ':' + e.graphic._layer.id;
				this.markerComponent.remove([id]);

				var m = this.createFeatureMarker(e.graphic, {
					lat: e.graphic.geometry.getLatitude(),
					lon: e.graphic.geometry.getLongitude()
				});
				this.markerComponent.add([m]);
			}), 0);
		},

		/**
		 * Layer Visibility Change
		 * @param layer object
		 * @param visible boolean
		 * @private
		 */
		_layerVisibilityChangeCallback: function (layer, visible) {
			setTimeout(lang.hitch(this, function () {
				console.log('MapillaryViewer::MapillaryObjects::_layerVisibilityChangeCallback', layer);

				if (!visible) {
					this._removeLayer(layer);
				} else {
					this._addLayer(layer);
				}
				delete this._query[this.node.originalLatLon.lat + '' + this.node.originalLatLon.lon];
				this._onNodeChangedCallback(this.node);
			}), 500);
		},

		/**
		 * Graphic Node Edit Complete Callback
		 * @param e
		 * @private
		 */
		_graphicNodeEditCompleteCallback: function (e) {
			setTimeout(lang.hitch(this, function () {
				var errors = [],
					updates = e.updates.concat(e.adds).filter(function (l) {
						return !!l;
					}),
					deletes = e.deletes.filter(function (l) {
						return !!l;
					}),
					layer = e.target;
				console.log('MapillaryViewer::MapillaryObjects::_graphicNodeEditCompleteCallback', updates, deletes, layer);

				deletes.forEach(lang.hitch(this, function (f) {
					if (f.error) {
						errors = errors.push(f.error);
						return;
					}
					var id = f.objectId + ':' + layer.id;
					this.markerComponent.remove([id]);
				}));
				if (updates.length) {
					errors.concat(updates.filter(function (update) {
						return !!update.error;
					}));
					updates = updates.filter(function (update) {
						return !update.error;
					});
					var query = new Query();
					query.returnGeometry = true;
					query.where = updates.map(function (l) {
						return 'OBJECTID = ' + l.objectId;
					}).join(' OR ');
					query.outFields = ["*"];
					layer.queryFeatures(query, lang.hitch(this, function (featureSet) {
						featureSet.features.forEach(lang.hitch(this, function (f) {
							setTimeout(lang.hitch(this, function () {
								var id = f.attributes.OBJECTID + ':' + layer.id;
								this.markerComponent.remove([id]);

								setTimeout(lang.hitch(this, function () {
									var m = this.createFeatureMarker(f, {
										interactive: true,
										lat: f.geometry.getLatitude(),
										lon: f.geometry.getLongitude()
									});
									this.markerComponent.add([m]);
								}), 10);
							}), 0);
						}));
					}));
				}
				if (errors.length) {
					console.error(errors);
				}
			}), 0);
		}
	})
});