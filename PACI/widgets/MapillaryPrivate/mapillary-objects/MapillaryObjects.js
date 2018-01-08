/* globals define */

define([
	'dojo/_base/declare',
	'dojo/_base/lang',

	'esri/layers/VectorTileLayer',

	'dojox/lang/functional/object',
	'../mapillaryUtils'
], function(declare, lang,
            VectorTileLayer,
            Object,
            mapillaryUtils) {
	/**
	 * TrafficSigns
	 * @class TrafficSigns
	 */
	return declare(null, {
		/**
		 * Constructor
		 * @param viewer
		 * @param map
		 * @param clientId
		 * @param defaultVisible
		 */
		constructor: function(viewer, map, clientId, defaultVisible) {
			this.map = map;
			this.viewer = viewer;
			this.markerComponent = this.viewer.getComponent('marker');
			this.defaultVisible = defaultVisible;
			this._events = [];
			this.clientId = clientId;
		},

		/**
		 * Create Mapillary Objects Layer
		 */
		createMapillaryObjectsLayer: function() {
			this.objectLayer = mapillaryUtils.createMapillaryObjectsLayer();
			this.map.addLayer(this.objectLayer);
			this.objectLayer.setVisibility(this.defaultVisible);
		},

		/**
		 * Destroy
		 */
		destroy: function() {
			this._events.forEach(function(e) {
				e && typeof e.remove === 'function' && e.remove();
			});
		},

		/**
		 * Show
		 */
		show: function() {
			this.viewer._container.element.parentElement.classList.remove('hide-signs');
			this.objectLayer.setVisibility(true);
			// not sure if this is necessary
			this.markerComponent.configure({mapillaryObjects: true});
		},

		/**
		 * Hide
		 */
		hide: function() {
			this.viewer._container.element.parentElement.classList.add('hide-signs');
			this.objectLayer.setVisibility(false);
			this.markerComponent.configure({mapillaryObjects: false});
		}
	})
});