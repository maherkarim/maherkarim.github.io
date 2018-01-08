/* globals define, esri */
define([
	'dojo/_base/declare',
	'dojo/_base/lang',
	'dojo/_base/window',
	'dojo/_base/array',
	'dojo/dom',
	'dojo/on',
	'dojo/topic',
	'dojo/debounce',
	'dojo/Deferred',
	'dojo/promise/all',
	'dojo/store/Memory',
	'dojo/dom-construct',
	'dojo/dom-style',
	'dojo/dom-class',
	'dojo/query',
	'dojo/io-query',
	'dojo/aspect',

	'dijit/_WidgetsInTemplateMixin',
	'dijit/form/Form',
	'dijit/form/CheckBox',
	'dijit/form/TextBox',
	'dijit/form/DateTextBox',
	'dijit/form/ComboBox',

	'./lib/terraformer', // moved this higher to avoid initialization issue

	'esri/layers/GraphicsLayer',
	'esri/dijit/editing/Editor',
	'esri/toolbars/edit',
	'esri/dijit/editing/TemplatePicker',
	'esri/Color',
	'esri/geometry/Point',
	'esri/geometry/webMercatorUtils',
	'esri/graphic',
	'esri/tasks/query',
	'esri/InfoTemplate',
	'esri/SpatialReference',
	'esri/symbols/SimpleLineSymbol',
	'esri/symbols/SimpleMarkerSymbol',
	'esri/symbols/PictureMarkerSymbol',
	"esri/renderers/SimpleRenderer",

	'jimu/BaseWidget',
	'jimu/LayerInfos/LayerInfos',
	'jimu/dijit/LoadingIndicator',
	'jimu/dijit/Message',

	'./mapillaryUtils',
	'./mapillary-objects/MapillaryObjects',
	'./mapillary-objects/MapillaryMarkers',
	'widgets/MapillaryPrivate/TagCloud',

	'./lib/GeoJsonLayer',
	'./lib/terraformer-arcgis-parser',
	'./lib/terraformer-wkt-parser'
], function(declare, lang, window, array, dom, on, topic, debounce, Deferred, all, Memory, domConstruct, domStyle, domClass, domQuery, ioQuery, aspect,
            _WidgetsInTemplateMixin, Form, CheckBox, TextBox, DateTextBox, ComboBox,
            Terraformer,
            GraphicsLayer, Editor, EditToolbar, TemplatePicker, Color, Point, webMercatorUtils, Graphic, Query, InfoTemplate, SpatialReference, SimpleLineSymbol, SimpleMarkerSymbol, PictureMarkerSymbol, SimpleRenderer,
            BaseWidget, LayerInfos, LoadingIndicator, Message,
            mapillaryUtils, MapillaryObjects, MapillaryMarkers, TagCloud,
            GeoJsonLayer) {
	var addMapillaryLayerInfoIsVisibleEvent;

	/**
	 * Mapillary WebApp Builder Widget
	 */
	return declare([BaseWidget, _WidgetsInTemplateMixin], {
		baseClass: 'mapillary',

		/**
		 * Post Create
		 */
		postCreate: function() {
			this.inherited(arguments);
			console.log('Mapillary::postCreate');
			this._events = [];
		},

		/**
		 * Startup
		 */
		startup: function() {
			this.inherited(arguments);
			console.log('Mapillary::startup');
			this._initLoading();
			this._initEvents();

			if (!this.config.clientId || this.config.clientId === '') {
				this.noticeNode.innerHTML = '<a href="https://www.mapillary.com/app/settings/developers" target="_blank">Register for an App ID</a>';
			} else
				this.noticeNode.innerHTML = 'Click on the map to display the location';
			domStyle.set(this.noticeNode, 'display', 'block');
			domStyle.set(this.authorizeNode, 'display', '');

			this._configEditor = this.config.editor ? lang.clone(this.config.editor) : {};

			mapillaryUtils
				.setClientId(this.config.clientId)
				.setAuthScope('private:read')
				.setCallbackUrl(this.config.callbackUrl);
			this.authenticate();
		},

		/**
		 * Authenticate with Mapillary
		 */
		authenticate: function() {
			return mapillaryUtils.authenticate(true).then(
				lang.hitch(this, this._initWidget),
				lang.hitch(this, function(error) {
					if (error.error)
						new Message({
							type: 'error',
							message: error.error
						});
				})
			);
		},

		/**
		 * Init Widget
		 * @private
		 */
		_initWidget: function() {
			var def = new Deferred();
			domStyle.set(this.authorizeNode, 'display', 'none');
			domStyle.set(this.form.domNode, 'display', '');

			this._getUserProjects();

			this._createMapillaryViewer();
			this._addMapillaryCoverageLayerToMap();
			this.mapillaryObjects.createMapillaryObjectsLayer();
			this._addMapillaryLayerInfoIsVisibleEventToMap();
			this._addMapillaryClickEventToMap();
			this._initTrafficSignLinks();
			this.mapillary.on('bearingchanged', lang.hitch(this, this.onBearingChanged));
			this.widgetReady('Edit').then(lang.hitch(this, function(editWidget) {
				this.editWidget = editWidget;
				this._initEditorEvents();
			}));

			this.mapillary.on('nodechanged', lang.hitch(this, this._onNodeChanged));

			LayerInfos.getInstance(this.map, this.map.itemInfo).then(lang.hitch(this, function(operLayerInfos) {
				this.layerInfos = operLayerInfos;
				this._setFormFromLayerInfos();
				def.resolve();
			}));
			return def.promise;
		},

		/**
		 * Get Form Values
		 */
		getFormValues: function() {
			return lang.mixin({}, this.form.get('value'), {
				trafficSigns: this.trafficSigns.get('checked'),
				projectId: this.projectId.item ? this.projectId.store.getValue(this.projectId.item, 'key') : null
			});
		},

		/**
		 * Resize
		 */
		resize: function() {
			console.log('Mapillary::resize');
			this.mapillary && this.mapillary.resize();
		},

		/**
		 * Maximize
		 */
		maximize: function() {
			var isFullscreen = !domClass.contains(this.domNode, 'mini');
			console.log('MapillaryViewer::maximize');
			if (isFullscreen) {
				domClass.remove(this.map.container, 'mini');
				domClass.add(this.map.container, 'fullscreen');
				domClass.remove(this.domNode, 'fullscreen');
				domClass.add(this.domNode, 'mini');
				domConstruct.place(this.minimizeNode, this.domNode);
				domConstruct.place(this.maximizeNode, this.domNode);
			} else {
				domClass.remove(this.map.container, 'fullscreen');
				domClass.add(this.map.container, 'mini');
				domClass.remove(this.domNode, 'mini');
				domClass.add(this.domNode, 'fullscreen');
				domConstruct.place(this.minimizeNode, this.map.container);
				domConstruct.place(this.maximizeNode, this.map.container);
			}
			this.emit('maximize');
			topic.publish('MapillaryViewerMaximize');
			this._resizeEvent();
		},

		/**
		 * Minimize
		 */
		minimize: function() {
			var isFullscreen = !domClass.contains(this.domNode, 'mini');
			if (isFullscreen) {
				domStyle.set(this.map.container, 'display', 'none'); //hide map
			} else {
				domQuery('.mly-wrapper', this.domNode).style('display', 'none'); //hide widget
			}
			domStyle.set(this.minimizeNode, 'display', 'none'); //hide minimize
			domStyle.set(this.maximizeNode, 'display', 'none'); //hide maximize
			this.emit('minimize');
			topic.publish('MapillaryViewerMinimize');
			this._resizeEvent();
		},

		/**
		 * Restore
		 */
		restore: function() {
			var isFullscreen = !domClass.contains(this.domNode, 'mini');
			if (isFullscreen) {
				domStyle.set(this.map.container, 'display', ''); //show map
			} else
				domQuery('.mly-wrapper', this.domNode).style('display', ''); //show widget
			domStyle.set(this.minimizeNode, 'display', ''); //show minimize
			domStyle.set(this.maximizeNode, 'display', ''); //show maximize
			this.emit('restore');
			topic.publish('MapillaryViewerRestore');
			this.resize();
		},

		/**
		 * Toggle Viewer Visibility
		 * @param val
		 */
		toggleViewerVisibility: function(val) {
			var klaz = 'hide-viewer-content';

			if (val) {
				this.parentEl.classList.remove(klaz);
			} else {
				this.parentEl.classList.add(klaz);
			}
		},

		/**
		 * Filter Mapillary Layer
		 * Uses VectorTileLayer.setStyle to filter Mapillary layer
		 * @param filters object <username,toDate,fromDate,panorama,segmentation>
		 */
		filterMapillaryLayer: function(filters) {
			//https://www.mapbox.com/mapbox-gl-style-spec/#types-filter
			var publicLayerStyle = lang.clone(mapillaryUtils.layersJson),
				projectLayerStyle = lang.clone(mapillaryUtils.projectLayersJson),
				isPublic,
				validFilters = {},
				filterLayers;

			//ensure filter values are not null, false, or an empty array in the case of a checkbox
			for (var filter in filters) {
				var isEmptyArray = (filters[filter] instanceof Array ? filters[filter].length === 0 : false),
					isNull = !filters[filter] || filters[filter] === '',
					isEventAttr = ['detail', 'bubbles', 'cancelable'].indexOf(filter) !== -1;
				if (filters.hasOwnProperty(filter) && !isEventAttr && !isNull && !isEmptyArray)
					validFilters[filter] = filters[filter];
			}

			isPublic = !validFilters.projectId || validFilters.projectId === 'public';
			if (isPublic) {
				filterLayers = publicLayerStyle.layers;
			} else {
				filterLayers = projectLayerStyle.layers;
			}

			//show traffic signs layer
			if (validFilters.trafficSigns === 'true' || validFilters.trafficSigns === true) {
				this.showMapillaryTrafficSignsLayer(true);
				this.trafficSigns.set('checked', true);
			} else {
				this.showMapillaryTrafficSignsLayer(false);
				this.trafficSigns.set('checked', false);
			}

			filterLayers.forEach(function(layer) {
				layer.filter = [];
				if (validFilters.userList) {
					var userFilter = ['in', 'userkey'];
					validFilters.userList.forEach(function(user) {
						userFilter.push(user.key);
					});
					layer.filter.push(userFilter);
				}
				if (validFilters.fromDate)
					layer.filter.push(['>=', 'captured_at', validFilters.fromDate.getTime()]);
				if (validFilters.toDate)
					layer.filter.push(['<=', 'captured_at', validFilters.toDate.getTime()]);
				if (validFilters.panorama)
					layer.filter.push(['==', 'panorama', true]);
				if (validFilters.segmentation)
					layer.filter.push(['==', 'segmentation', true]);
				if (!isPublic && validFilters.projectId)
					layer.filter.push(['==', 'pkey', validFilters.projectId]);

				if (layer.filter.length)
					layer.filter.unshift("all");
				else
					delete layer.filter;
			});

			if (isPublic) {
				projectLayerStyle.layers.forEach(function(layer) {
					delete layer.filter;
				});
				this.projectCoverageLayers.setStyle(projectLayerStyle);
				this.showMapillaryLayer(true).showMapillaryProjectLayer(false);
				this.publicCoverageLayers.setStyle(publicLayerStyle).then(lang.hitch(this, function() {
					console.log("Mapillary::filterMapillaryLayer", validFilters, publicLayerStyle);
				}), function(e) {
					console.error("Mapillary::filterMapillaryLayer", e, validFilters, publicLayerStyle);
					new Message({
						type: 'error',
						message: e.message
					});
				});
			} else {
				publicLayerStyle.layers.forEach(function(layer) {
					delete layer.filter;
				});
				this.publicCoverageLayers.setStyle(publicLayerStyle);
				this.showMapillaryLayer(false).showMapillaryProjectLayer(true);
				this.projectCoverageLayers.setStyle(projectLayerStyle).then(lang.hitch(this, function() {
					console.log("Mapillary::filterMapillaryLayer", validFilters, projectLayerStyle);
				}), function(e) {
					console.error("Mapillary::filterMapillaryLayer", e, validFilters, projectLayerStyle);
					new Message({
						type: 'error',
						message: e.message
					});
				});
			}
		},

		/**
		 * Show Mapillary Layer
		 * @param visible boolean
		 * @returns {*}
		 */
		showMapillaryLayer: function(visible) {
			var layer = this.publicCoverageLayers;
			if (visible)
				layer.show();
			else
				layer.hide();

			return this;
		},

		/**
		 * Show Mapillary Project Layer
		 * @param visible boolean
		 * @returns {*}
		 */
		showMapillaryProjectLayer: function(visible) {
			var layer = this.projectCoverageLayers;
			if (visible)
				layer.show();
			else
				layer.hide();
			return this;
		},

		/**
		 * Show Mapillary Traffic Signs Layer
		 * Waits for the MapillaryViewer to be ready, then enables the Traffic Signs layer
		 * @param visible boolean
		 */
		showMapillaryTrafficSignsLayer: function(visible) {
			if (this.mapillaryObjects) {
				if (visible)
					this.mapillaryObjects.show();
				else
					this.mapillaryObjects.hide();
			}
		},

		/**
		 * Widget Ready
		 * @param id
		 */
		widgetReady: function(id) {
			if (!this._readyWidgets)
				this._readyWidgets = {};
			if (!this._readyWidgets[id]) {
				this._readyWidgets[id] = new Deferred();

				var widgetManagerEvent,
					widget = this.widgetManager.getWidgetsByName(id);
				if (widget && widget.length)
					this._readyWidgets[id].resolve(widget[0]);
				else {
					widgetManagerEvent = on(this.widgetManager, 'widget-created', lang.hitch(this, function(widget) {
						if (widget && widget.name === id) {
							widgetManagerEvent.remove();
							this._readyWidgets[id].resolve(widget);
						}
					}));
				}
			}
			return this._readyWidgets[id].promise;
		},

		/**
		 * Attach Layer Events
		 * @private
		 */
		_attachMapEvents: function() {
			this._mapillaryCoverageLayer = new GeoJsonLayer({
				id: 'Mapillary_Coverage_Zoom',
				maxdraw: 100000,
				renderer: new SimpleRenderer({
					symbol: new SimpleMarkerSymbol(SimpleMarkerSymbol.STYLE_CIRCLE,
						11,
						null,
						'#39AF64'
					)
				}),
				data: {
					type: 'FeatureCollection',
					features: []
				}
			});
			this._mapillaryCoverageLayer.disableMouseEvents();
			this._mapillaryCoverageLayer.setInfoTemplate(null);
			this.map.addLayer(this._mapillaryCoverageLayer);
			this._mapillaryCoverageLayer.show();
			this._mapExtentChangeEvent = this.map.on('extent-change', lang.hitch(this, this._mapExtentChange));
		},

		/**
		 * Remove Map Events
		 * @private
		 */
		_removeMapEvents: function() {
			this.map.removeLayer(this._mapillaryCoverageLayer);
			this._mapillaryCoverageLayer = null;
			this._mapExtentChangeEvent.remove();
			this._mapExtentChangeEvent = null;
		},

		/**
		 * Map Extent Change
		 * @private
		 */
		_mapExtentChange: function(e) {
			if (this.map.getZoom() > 15) {
				var extent = webMercatorUtils.webMercatorToGeographic(e.extent);
				mapillaryUtils.imageSearch(lang.mixin({}, this.getFormValues(), {
					bbox: [extent.xmin,extent.ymin,extent.xmax,extent.ymax],
					per_page: 1000
				})).then(lang.hitch(this, function(result) {
					//this._mapillaryCoverageLayer.clear();
					this._mapillaryCoverageLayer._getGeoJson(result)
				}))
			} else if (this._mapillaryCoverageLayer)
				this._mapillaryCoverageLayer.clear();
		},

		/**
		 * Set Form From LayerInfos
		 * @private
		 */
		_setFormFromLayerInfos: function() {
			this.layerInfos._finalLayerInfos.forEach(lang.hitch(this, function(layerInfo) {
				if (layerInfo.id === 'Mapillary_Traffic_Signs') {
					if (layerInfo._visible)
						this.form.set('value', {
							trafficSigns: ['on']
						});
					else
						this.form.set('value', {
							trafficSigns: null
						});
				}
			}));
		},

		/**
		 * Init Traffic Sign Links
		 * @private
		 */
		_initTrafficSignLinks: function() {
			domQuery('a', this.trafficSignsLinksNode).forEach(lang.hitch(this, function(link) {
				on(link, 'click', lang.hitch(this, function(e) {
					e.preventDefault();
					var linkObj = ioQuery.queryToObject(e.target.href.substring(e.target.href.indexOf('?') + 1)),
						stateObj = lang.mixin({
							lat: null,
							lng: null,
							z: 15
						}, linkObj);
					if (stateObj.lat && stateObj.lng) {
						this.map.centerAndZoom(new Point(stateObj.lng, stateObj.lat), parseInt(stateObj.z) || this.map.getZoom());
						if (stateObj.trafficSigns === true || stateObj.trafficSigns === 'true')
							this.showMapillaryTrafficSignsLayer(true);
						else
							this.showMapillaryTrafficSignsLayer(false);
					} else
						console.error('Must provide lat & lng!');
				}));
			}));
		},

		/**
		 * Throw Resize Event
		 * @private
		 */
		_resizeEvent: function() {
			setTimeout(lang.hitch(this, function() {
				var event;
				this.resize(); //in-case below fails
				//ie 11
				if (document.createEvent) {
					event = document.createEvent('Event');
					event.initEvent('resize', true, true);
				} else
					event = new Event('resize');

				window.global.dispatchEvent(event);
			}), 0);
		},

		/**
		 * Create Mapillary Viewer
		 */
		_createMapillaryViewer: function() {
			this.mapillary = mapillaryUtils.getViewer('mly-prv');
			// Initialize MapillaryObjects Extension
			this.mapillaryObjects = new MapillaryObjects(this.mapillary, this.map, this.config.clientId, false);
			// Initialize MapillaryMarkers Extension
			this.mapillaryMarkers = new MapillaryMarkers(this.mapillary, this.map);

			// Hide Mapillary viewer
			this.parentEl = this.mapillary._container.element.parentElement;
			this.toggleViewerVisibility(true);
		},

		/**
		 * Get User Projects
		 * @private
		 */
		_getUserProjects: function() {
			mapillaryUtils.getCurrentUser().then(lang.hitch(this, function(user) {
				this.projectId.store.idProperty = 'key';
				this.projectId.store.setData([
					{

						key: "public",
						name: "Mapillary Public"
					}
				]);
				this.projectId.set('value', 'Mapillary Public');
				mapillaryUtils.getUserProjects(user.key).then(lang.hitch(this, function(projects) {
					projects.unshift({
						key: "public",
						name: "Mapillary Public"
					});
					this.projectId.store.setData(projects);
					this.projectId.set('value', 'Mapillary Public');
				}));
			}));
		},

		/**
		 * Add Mapillary Coverage Layer to Map
		 */
		_addMapillaryCoverageLayerToMap: function() {
			this.publicCoverageLayers = mapillaryUtils.createMapillaryCoverageLayer();
			this.map.addLayer(this.publicCoverageLayers);

			this.publicCoverageLayers.on('error', function(err) {
				console.error(err.error);
			});

			this.projectCoverageLayers = mapillaryUtils.createMapillaryProjectCoverageLayer();
			this.map.addLayer(this.projectCoverageLayers);

			this.projectCoverageLayers.on('error', function(err) {
				console.error(err.error);
			});
		},

		/**
		 * Add Mapillary Click Event to Map
		 */
		_addMapillaryClickEventToMap: function() {
			if (this.mapClickEvent)
				this.mapClickEvent.remove();
			// Bind event to map click
			return this.mapClickEvent = this.map.on('click', lang.hitch(this, function(event) {
				if (event.which !== 1) //ignore middle/right click
					return;
				console.log('Mapillary::mapClick', event);

				var filter = this.getFormValues(),
					editToolbar = this.editWidget && this.editWidget.editor && this.editWidget.editor.editToolbar,
					currentState = editToolbar && editToolbar.getCurrentState(),
					currentTool = currentState && currentState.tool,
					eventTimeout = currentTool === 0 ? 350 : 0, // on add (0) tool, delay slightly
					currentGraphic = (currentState && currentState.graphic) || event.graphic,
					point;

				setTimeout(lang.hitch(this, function() {
					currentState = editToolbar && editToolbar.getCurrentState();
					currentTool = currentState && currentState.tool;
					currentGraphic = (currentState && currentState.graphic) || event.graphic;
					if (currentTool) {

					} else if (!currentGraphic || currentGraphic._layer.id === 'Mapillary_Coverage_Zoom') {
						this.loading.show();
						this.restore();
						point = webMercatorUtils.webMercatorToGeographic(event.mapPoint);
						mapillaryUtils.imageSearch(lang.mixin({
							closeto: point.x.toFixed(10) + ',' + point.y.toFixed(10),
							radius: 2000,
							max: 20
						}, filter)).then(lang.hitch(this, function(res) {
							if (res.features.length) {
								this.mapillary.moveToKey(res.features[0].properties.key);
								this.toggleViewerVisibility(true);
							} else {
								console.error('No images found.')
							}
							this.loading.hide();
						}), lang.hitch(this, function(err) {
							console.error(err);
							this.loading.hide();
						}));
					} else {
						this.loading.show();
						this.restore();
						switch (currentGraphic.type) {
							case 'polygon':
							case 'multipoint':
							case 'polyline':
								point = currentGraphic.getExtent().getCenter();
								break;
							case 'extent':
								point = currentGraphic.getCenter();
								break;
							default:
							case 'point':
								point = currentGraphic && currentGraphic.geometry;
								break;
						}
						mapillaryUtils.imageSearch(lang.mixin({
							closeto: point.x.toFixed(10) + ',' + point.y.toFixed(10),
							lookat: point.x.toFixed(10) + ',' + point.y.toFixed(10),
							radius: 2000,
							max: 20
						}, filter)).then(lang.hitch(this, function(res) {
							var i = 0,
								nearestImages = res.features.map(function(image) {
									return image.properties.key;
								}).filter(function(image) {
									return ++i <= 10; //return top 10
								});
							/* If not clicking on a graphic, move to nearest */
							if (nearestImages && !currentGraphic) {
								return this.mapillary.moveToKey(nearestImages[0]);
								/* Only move if the current image is not one of nearestImages*/
							} else if (nearestImages.length && nearestImages.indexOf(this.mapillary._navigator.keyRequested$ && this.mapillary._navigator.keyRequested$._value) === -1) {
								// FIXME Sometimes the closest image is too close
								return this.mapillary.moveToKey(nearestImages[0]);
							} else {
								var def = new Deferred();
								def.resolve();
								return def.promise;
							}
						}), lang.hitch(this, function() {
							this.loading.hide();
						})).then(lang.hitch(this, function() {
							this.toggleViewerVisibility(true);
							this.loading.hide();
						}), lang.hitch(this, function(err) {
							console.error(err);
							this.loading.hide();
							console.error('We couldn\'t load the data from the map, zoom in to the area that interests you an try clicking again');
						}));
					}
				}), eventTimeout)
			}));
		},

		/**
		 * Add Mapillary LayerInfosIsVisible Event to Map
		 * This event allows for the MapillaryFilter widget to update its Traffic Signs checkbox when the layer is made visible via the LayerList
		 * @returns Deferred.promise
		 */
		_addMapillaryLayerInfoIsVisibleEventToMap: function() {
			var def = new Deferred();
			LayerInfos.getInstance(this.map, this.map.itemInfo).then(function(operLayerInfos) {
				if (addMapillaryLayerInfoIsVisibleEvent)
					addMapillaryLayerInfoIsVisibleEvent.remove();
				addMapillaryLayerInfoIsVisibleEvent = operLayerInfos.on('layerInfosIsVisibleChanged', function(changedLayerInfo) {
					changedLayerInfo.forEach(function(layerInfo) {
						if (layerInfo.id === 'Mapillary_Traffic_Signs') {
							console.log('Mapillary::_addMapillaryLayerInfoIsVisibleEventToMap', layerInfo.layerObject.visible);
							topic.publish('MapillaryFilter', {
								trafficSigns: layerInfo.layerObject.visible
							});
						}
					});
				});
				def.resolve(operLayerInfos);
			});
			return def.promise;
		},

		/**
		 * On Filter Change
		 * @param e
		 * @private
		 */
		_onFilterChange: function(e) {
			e && typeof e.preventDefault === 'function' && e.preventDefault();
			var values = this.getFormValues();
			console.log('Mapillary::_onFilterChange', values);

			this.emit('mapillaryFilter', values);
			topic.publish('MapillaryFilter', values);
		},

		/**
		 * On Username Change
		 * @param e
		 * @private
		 */
		_onUsernameChange: function(e) {
			var _user;
			this.userSearch.store.idProperty = 'key';
			this.userSearch.store.data.forEach(lang.hitch(this, function(user) {
				if (user.username === this.userSearch.get('value'))
					_user = user;
			}));
			if (_user)
				this.userList.addValue(_user);
			this.userSearch.set('value', '');
			this.userSearch.store.setData([]);
		},

		/**
		 * On Username Keyup
		 * @param e
		 * @private
		 */
		_onUsernameKeyup: function(e) {
			var value = this.userSearch.get('displayedValue');
			mapillaryUtils.userFuzzySearch(value).then(lang.hitch(this, function(users) {
				users = users.filter(function(user) {
					return !!user;
				});
				this.userSearch.set('store', new Memory({
						data: users
					})
				);
				if (users.length > 0)
					this.userSearch.loadAndOpenDropDown();
				else
					this.userSearch.closeDropDown(true);
			}));
		},

		/**
		 * On Bearing Change
		 * @param num
		 */
		onBearingChanged: function(num) {
			this.directionSymbol.setAngle(num);
			this.map.graphics.refresh();
		},

		/**
		 * On Mapillary Node Change
		 * @param node
		 */
		_onNodeChanged: function(node) {
			var lon = node.originalLatLon.lon;
			var lat = node.originalLatLon.lat;

			domStyle.set(this.noticeNode, 'display', 'none');
			this.map.graphics.clear();
			this.toggleViewerVisibility(true);
			this.mapillary.resize();

			var pt = new Point(lon, lat, new SpatialReference({'wkid': 4326}));

			this.directionSymbol = new PictureMarkerSymbol(this.folderUrl + 'images/icon-direction.png', 26, 52);
			this.directionSymbol.setAngle(node.ca);

			var marker = new SimpleMarkerSymbol(
				SimpleMarkerSymbol.STYLE_CIRCLE,
				20,
				new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID,
					new Color([255, 255, 255]),
					3),
				new Color([255, 134, 27]));

			this.map.graphics.add(new Graphic(
				webMercatorUtils.geographicToWebMercator(pt),
				marker,
				{'title': lon + ' ' + lat, 'content': 'A Mapillary Node'},
				new InfoTemplate('${title}', '${content}')
			));
			this.map.graphics.add(new Graphic(
				webMercatorUtils.geographicToWebMercator(pt),
				this.directionSymbol
			));
			this.map.centerAt(pt);
			topic.publish('mapillaryNodeChange', node);
		},


		/**
		 * Init Events
		 * @private
		 */
		_initEvents: function() {
			on(this.authorizeButtonNode, 'click', lang.hitch(this, this.authenticate));

			// set searchAttr and validator on users
			this.userSearch.set({
				validator: function() {
					return true;
				},
				searchAttr: 'username'
			});

			/*
			 * Mapillary Viewer Editing
			 */
			this.own(topic.subscribe('MapillaryViewerEdit', lang.hitch(this, this._onMapillaryViewerEdit)));
			this.own(topic.subscribe('MapillaryViewerAdd', lang.hitch(this, this._onMapillaryViewerAdd)));
			this.own(topic.subscribe('MapillaryViewerSelect', lang.hitch(this, this._onMapillaryViewerSelect)));

			/*
			 * Mapillary Filters
			 */
			topic.subscribe('MapillaryFilter', lang.hitch(this, this.filterMapillaryLayer));
			this.projectId.on('change', lang.hitch(this, this._onFilterChange));
			this.fromDate.on('change', lang.hitch(this, this._onFilterChange));
			this.toDate.on('change', lang.hitch(this, this._onFilterChange));
			this.userList.on('remove', lang.hitch(this, this._onFilterChange));
			this.userList.on('add', lang.hitch(this, this._onFilterChange));
			this.userSearch.on('keyup', lang.hitch(this, debounce(this._onUsernameKeyup, 300)));
			this.userSearch.on('change', lang.hitch(this, this._onUsernameChange));
			this.trafficSigns.on('change', lang.hitch(this, this._onFilterChange));
			this.form.on('submit', lang.hitch(this, this._onFilterChange));
		},

		/**
		 * Init Editor Toolbar Events
		 * @private
		 */
		_initEditorToolbarEvents: function() {
			var interval = setInterval(lang.hitch(this, function() {
				if (this.editWidget.editor.editToolbar) {
					clearInterval(interval);
					this.own(this.editWidget.editor.editToolbar.on('draw-complete', lang.hitch(this, this._onDrawComplete)));
					this.own(this.editWidget.editor.editToolbar.on('graphic-move', lang.hitch(this, this._onGraphicMove)));
					this.own(this.editWidget.editor.editToolbar.on('graphic-move-stop', lang.hitch(this, this._onGraphicMoveStop)));
					this.own(this.editWidget.editor.editToolbar.on('activate', lang.hitch(this, this._onToolbarActivate)));
					this.own(this.editWidget.editor.editToolbar.on('deactivate', lang.hitch(this, this._onToolbarDeactivate)));
					this.own(this.editWidget.editor.templatePicker.on('selection-change', lang.hitch(this, this._onTemplateSelectionChange)));
				}
			}), 100);
		},

		/**
		 * Init Editor Events
		 * @private
		 */
		_initEditorEvents: function() {
			if (this.editWidget.state === 'opened')
				topic.publish('MapillaryEditOpen');
			aspect.after(this.editWidget, 'onOpen', lang.hitch(this, function() {
				topic.publish('MapillaryEditOpen');
			}));
			aspect.after(this.editWidget, 'onClose', lang.hitch(this, function() {
				topic.publish('MapillaryEditClose');
			}));
			aspect.after(this.editWidget, 'onActivate', lang.hitch(this, function() {
				topic.publish('MapillaryEditActive');
			}));
			aspect.after(this.editWidget, 'onDeactivate', lang.hitch(this, function() {
				topic.publish('MapillaryEditDeactive');
			}));

			if (this.editWidget._started)
				this._initEditorToolbarEvents();
			else
				aspect.after(this.editWidget, 'startup', lang.hitch(this, function() {
					console.log('Edit::startup');
					this._initEditorToolbarEvents();
				}));
		},

		/**
		 * On Template Picker Selection Change
		 * @private
		 */
		_onTemplateSelectionChange: function(val) {
			topic.publish('MapillaryEditTemplate', val);
		},

		/**
		 * On Mapillary Viewer Edit
		 * @param marker
		 * @private
		 */
		_onMapillaryViewerEdit: function(marker) {
			setTimeout(lang.hitch(this, function() {
				var pt = new Point(marker.latLon.lon, marker.latLon.lat);
				if (webMercatorUtils.canProject(pt, this.map.spatialReference)) {
					pt = webMercatorUtils.project(pt, this.map);
				}
				marker._feature.geometry = pt;
				this.editWidget.editor._applyEdits([{
					layer: marker._layer,
					updates: [marker._feature]
				}]);
				this.editWidget.editor._clearSelection();
				this.editWidget.editor.editToolbar.refresh();
			}, 0));
		},

		/**
		 * On Mapillary Viewer Select
		 * @param marker
		 * @private
		 */
		_onMapillaryViewerSelect: function(marker) {
			console.log('MapillaryEdit::_onMapillaryViewerSelect', marker, marker._feature);

			//this.editWidget.editor._enableMapClickHandler();
			this.editWidget.editor.editToolbar.activate(EditToolbar.MOVE, marker._feature);
			this.editWidget.editor.editToolbar.refresh();

			var query = new Query();
			query.objectIds = [marker._feature.attributes[marker._layer.objectIdField]];
			marker._layer.selectFeatures(query, esri.layers.FeatureLayer.SELECTION_NEW);
		},

		/**
		 * On Mapillary Viewer Add
		 * @param graphic
		 * @private
		 */
		_onMapillaryViewerAdd: function(graphic) {
			if (!graphic) {
				console.error('MapillaryEdit::_onMapillaryViewerAdd - no graphic');
				return;
			}
			var template = this.editWidget && this.editWidget.editor && this.editWidget.editor.templatePicker.getSelected(),
				pt = graphic.geometry;

			if (!template || !pt) {
				return;
			}

			if (webMercatorUtils.canProject(pt, this.map.spatialReference)) {
				pt = webMercatorUtils.project(pt, this.map);
			}
			graphic = new Graphic(pt, null, lang.mixin({}, template.template.prototype.attributes));
			graphic._layer = template.featureLayer;
			setTimeout(lang.hitch(this, function() {
				this.editWidget.editor._applyEdits([{
					layer: graphic._layer,
					adds: [graphic]
				}]);
				this.editWidget.editor._clearSelection();
				this.editWidget.editor.editToolbar.refresh();
			}, 0));
		},

		/**
		 * On Edit Toolbar Draw Complete
		 * @param e
		 * @private
		 */
		_onDrawComplete: function(e) {

		},

		/**
		 * On Edit Toolbar Active
		 * @param e
		 * @private
		 */
		_onToolbarActivate: function(e) {
			topic.publish('MapillaryEditActive', e);
		},

		/**
		 * On Edit Toolbar Deactivate
		 * @param e
		 * @private
		 */
		_onToolbarDeactivate: function(e) {
			this.editWidget.editor._clearSelection();
			topic.publish('MapillaryEditDeactive', e);
		},

		/**
		 * On Edit Toolbar Graphic Move
		 * @param e
		 * @private
		 */
		_onGraphicMove: function(e) {
			topic.publish('MapillaryEditMove', e);
		},

		/**
		 * On Edit Toolbar Graphic Move
		 * @param e
		 * @private
		 */
		_onGraphicMoveStop: function(e) {
			console.log('Mapillary::_onGraphicMoveStop', e);
			//e && e.graphic && e.graphic._layer && e.graphic._layer.applyEdits(null, [e.graphic], null);
			this.editWidget.editor._applyEdits([{
				layer: e.graphic._layer,
				updates: [e.graphic]
			}]);
			topic.publish('MapillaryEditMoveStop', e);
			this.editWidget.editor._clearSelection();
			this.editWidget.editor.editToolbar.refresh();
		},

		/**
		 * This function used for loading indicator
		 */
		_initLoading: function() {
			this.loading = new LoadingIndicator({
				hidden: true
			});
			this.loading.placeAt(this.domNode);
			this.loading.startup();
		},

		/**
		 * On Open
		 */
		onOpen: function() {
			console.log('Mapillary::onOpen');
			var values = this.getFormValues(),
				isPublic = (!values.projectId || values.projectId === 'public');
			if (values.trafficSigns)
				this.showMapillaryTrafficSignsLayer(true);
			isPublic && this.publicCoverageLayers && this.publicCoverageLayers.show();
			!isPublic && this.projectCoverageLayers && this.projectCoverageLayers.show();
			this._attachMapEvents();
			this._mapExtentChange(this.map);
		},

		/**
		 * On Close
		 */
		onClose: function() {
			console.log('Mapillary::onClose');
			this.showMapillaryTrafficSignsLayer(false);
			this.publicCoverageLayers && this.publicCoverageLayers.hide();
			this.projectCoverageLayers && this.projectCoverageLayers.hide();
			this._removeMapEvents();
		}

		// onMinimize: function(){
		//   console.log('Mapillary::onMinimize');
		// },

		// onMaximize: function(){
		//   console.log('Mapillary::onMaximize');
		// },

		// onSignIn: function(credential){
		//   console.log('Mapillary::onSignIn', credential);
		// },

		// onSignOut: function(){
		//   console.log('Mapillary::onSignOut');
		// },

		// onPositionChange: function(){
		//   console.log('Mapillary::onPositionChange');
		// }
	})
});
