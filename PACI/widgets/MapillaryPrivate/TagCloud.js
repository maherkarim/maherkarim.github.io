/*global define*/
define([
	'dojo/_base/declare',
	'dojo/_base/lang',
	'dojo/_base/array',
	'dojo/dom-construct',
	'dojo/dom-class',
	'dojo/on',
	'dojo/aspect',
	'dojo/mouse',
	'dojo/query',
	'dojo/store/Memory',
	'dojo/store/Observable',

	'dijit/registry',
	'dijit/focus',
	'dijit/Tooltip',
	'dijit/_WidgetBase',
	'dijit/_TemplatedMixin',
	'dijit/form/TextBox',
	'dijit/form/ValidationTextBox',
	'dijit/form/DateTextBox',
	'dijit/form/CheckBox',
	'dijit/form/_FormValueWidget',

	'dojox/lang/functional/object',

	'dojo/text!./TagCloud.html',
	'xstyle/css!./css/TagCloud.css'
], function(declare, lang, array, domConstruct, domClass, on, aspect, mouse, domQuery, Memory, Observable,
            registry, focusUtil, Tooltip, _WidgetBase, _TemplatedMixin, TextBox, ValidationTextBox, DateTextBox, CheckBox, _FormValueWidget,
            Object,
            template) {

	/**
	 * Tag Cloud Dijit
	 */
	return declare([ValidationTextBox, _FormValueWidget], {
		templateString: template,
		store: null,
		idAttr: 'id',
		labelAttr: 'label',

		/**
		 * Constructor
		 */
		constructor: function() {
			this.inherited(arguments);
			this.baseClass = 'tag-cloud';
		},

		/**
		 * Post Create
		 */
		postCreate: function() {
			this.inherited(arguments);
			this._elements = {};
			this.value = this.value || [];
			this.store = new Observable(new Memory({
				data: this.value
			}));
			var results = this.store.query({});
			this._observeHandle = results.observe(lang.hitch(this, function(object, removedFrom, insertedInto) {
				if (removedFrom > -1) { // existing object removed
					this._removeRow(object);
				}
				if (insertedInto > -1) { // new or updated object inserted
					this._renderRow(object);
				}
			}));

			if (this.value.length !== 0)
				this._renderTags();
		},

		/**
		 * Is Valid?
		 * @returns {boolean}
		 */
		isValid: function() {
			var valid = true;
			this.store.data.forEach(function(row) {
				var inValidWidgets = registry.findWidgets(row).filter(function(dijit) {
					return !(typeof dijit.validate === 'function' ? dijit.validate() : true);
				});
				if (inValidWidgets.length)
					valid = false;
			});
			return valid;
		},

		/**
		 * Add Value
		 * @param val
		 */
		addValue: function(val) {
			this.store.add(val);
			this.set('value', this.store.data);
			console.log('TagCloud::addValue', val, this.store.data);
			this.emit('add', this.value);
			return this;
		},

		/**
		 * Remove Value
		 * @param val
		 * @returns {Array}
		 */
		removeValue: function(val) {
			this.store.remove(typeof val === 'string' ? val : val[this.idAttr]);
			this.set('value', this.store.data);
			console.log('TagCloud::removeValue', val, this.store.data);
			this.emit('remove', this.value);
			return this;
		},

		/**
		 * Set Value on Blur
		 * @private
		 */
		_setBlurValue: function() {
		},

		/**
		 * Set Value
		 * @param value
		 * @returns {*|{dir, lang, textDir}|{dir, lang}}
		 * @private
		 */
		_setValueAttr: function(value) {
			if (typeof value === 'string') {
				try {
					value = JSON.parse(value);
				} catch (err) {

				}
			}
			if (value && value !== '' && !(value instanceof Array))
				this.value = [value];
			else if (value && value !== '')
				this.value = value;
			else
				this.value = [];
			this.textbox.value = JSON.stringify(this.value);
			this.store.setData(this.value);
			return this.inherited(arguments);
		},

		/**
		 * Get Value
		 * @returns {Array}
		 * @private
		 */
		_getValueAttr: function() {
			return this.value && JSON.parse(JSON.stringify(this.value)) || [];
		},

		/**
		 * On Change
		 * @private
		 */
		_onChange: function() {
			setTimeout(lang.hitch(this, function() {
				//trigger _setValueAttr
				if (this.get('value') !== this.value)
					this.set('value', this.get('value'));
				this._renderTags();
			}), 0);
		},

		/**
		 * Render Tags
		 * @private
		 */
		_renderTags: function() {
			domConstruct.empty(this.listNode);
			this.store.data.forEach(lang.hitch(this, this._renderRow));
		},

		/**
		 * Remove Row
		 * @param object
		 * @private
		 */
		_removeRow: function(object) {
			domConstruct.destroy(this._elements[object[this.idAttr]]);
			this._elements[object[this.idAttr]] = null;
		},

		/**
		 * Render Row
		 * @param object
		 * @returns {div}
		 * @private
		 */
		_renderRow: function(object) {
			var div = domConstruct.create('div', {
				id: 'tag-' + object[this.idAttr]
			}, this.listNode);
			this._elements[object[this.idAttr]] = div;
			var titleSpan = domConstruct.create('span', {
					className: this.baseClass + '-title',
					innerHTML: object[this.labelAttr]
				}, div),
				removeLink = domConstruct.create('a', {
					href: '#',
					className: this.baseClass + '-remove',
					innerHTML: '<span class="icon icon-times-circle"><img src="widgets/MapillaryPrivate/images/cross-white.svg"></span>'
				}, div);
			on(removeLink, 'click', lang.hitch(this, function(e) {
				e.preventDefault();
				this.removeValue(object);
			}));
			return div;
		}
	});
});