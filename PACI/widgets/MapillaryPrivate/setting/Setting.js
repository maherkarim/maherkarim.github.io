/* globals define */
define([
	'dojo/_base/declare',
	'jimu/BaseWidgetSetting'
],
function(declare, BaseWidgetSetting) {
	return declare([BaseWidgetSetting], {
		baseClass: 'mapillary-setting',

		postCreate: function() {
			// the config object is passed in
			this.setConfig(this.config)
		},

		setConfig: function(config) {
			this.clientId.value = config.clientId ? config.clientId : '';
			this.callbackUrl.value = config.callbackUrl ? config.callbackUrl : '';
			this.defaultProject.value = config.defaultProject ? config.defaultProject : '';
		},

		getConfig: function() {
			// WAB will get config object through this method
			return {
				clientId: this.clientId.value,
				callbackUrl: this.callbackUrl.value,
				defaultProject: this.defaultProject.value
			}
		}
	})
});