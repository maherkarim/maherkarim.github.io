define([
	'dojo/_base/declare',
	'dojo/_base/lang',
	'dojo/_base/window',
	'dojo/on',
	'dojo/request',
	'esri/request',
	'dojo/io-query',
	'dojo/Deferred',

	'esri/layers/VectorTileLayer',

	'jimu/MapManager',

	'dojo/text!./mapillary-style.json',
	'dojo/text!./mapillary-private-style.json',
	'dojo/text!./object-tiles.json',
	'./lib/async',
	'./lib/mapillary-js/mapillary.min'
], function(declare, lang, window, on, request, esriRequest, ioQuery, Deferred,
            VectorTileLayer,
            MapManager,
            layersJson, projectLayersJson, vectorLayerJson,
            async,
            Mapillary) {
	var authWindow,
		authDef,
		authToken,
		currentUser;

	try {
		layersJson = JSON.parse(layersJson);
		projectLayersJson = JSON.parse(projectLayersJson);
		vectorLayerJson = JSON.parse(vectorLayerJson);
	} catch (e) {
		console.error(e);
	}

	/**
	 * Mapillary Utils
	 */
	return window.global.mapillaryUtils = {
		Mapillary: Mapillary,
		layersJson: layersJson,
		projectLayersJson: projectLayersJson,
		vectorLayerJson: vectorLayerJson,
		authScope: 'mapillary:user',
		clientId: null,
		callbackUrl: null,

		/**
		 * API Request
		 * @param url
		 * @param requestParams
		 * @returns {*}
		 * @private
		 */
		_request: function(url, requestParams) {
			var def = new Deferred();
			var _request = request(url, {
				handleAs: 'json',
				headers: {
					'X-Requested-With': null,
					'Authorization': 'Bearer ' + authToken
				},
				query: lang.mixin({
					client_id: this.clientId
				}, requestParams)
			}, {
				useProxy: false,
				usePost: false
			});
			_request.then(function(result) {
				var linkHeader = _request.response.getHeader('Link'),
					linkRegex = /<http(s):\/\/[^\?]+\?([^#>]+)>; rel="([\w]+)"/,
					linkHeaders = linkHeader && linkHeader.match(new RegExp(linkRegex, 'g')) || [],
					linkHeaderUrl;
				linkHeaders.forEach(function(link) {
					linkHeaderUrl = link.match(linkRegex);
					if (linkHeaderUrl && linkHeaderUrl[3] === 'next')
						result.nextLink = linkHeaderUrl[2];
				});
				def.resolve(result);
			}, function(err) {
				def.reject(err);
			});
			return def.promise;
		},

		/**
		 * Filter Request Options
		 * @param requestOptions
		 * @param filter
		 * @returns {*}
		 * @private
		 */
		_filterRequestOptions: function(requestOptions, filter) {
			if (filter.toDate) {
				//ensure date is UTC
				filter.toDate.setTime(filter.toDate.getTime() - filter.toDate.getTimezoneOffset() * 60 * 1000);
				requestOptions.end_time = filter.toDate.toISOString();
			}
			if (filter.fromDate) {
				//ensure date is UTC
				filter.fromDate.setTime(filter.fromDate.getTime() - filter.fromDate.getTimezoneOffset() * 60 * 1000);
				requestOptions.start_time = filter.fromDate.toISOString();
			}
			if (filter.userList && filter.userList.length)
				requestOptions.usernames = filter.userList.map(function(user) {
					return user.username;
				}).join(',');
			return requestOptions;
		},

		/**
		 * Set Client ID
		 * @param clientId
		 * @returns {mapillaryUtils}
		 */
		setClientId: function(clientId) {
			this.clientId = clientId;
			return this;
		},

		/**
		 * Set Auth Token
		 * @param token
		 * @returns {global.mapillaryUtils}
		 */
		setAuthToken: function(token) {
			authToken = token;
			for (var instance in this.mapillary) {
				if (this.mapillary.hasOwnProperty(instance))
					instance.setAuthToken(authToken);
			}
			return this;
		},

		/**
		 * Set Auth Scope
		 * @param authScope
		 * @returns {mapillaryUtils}
		 */
		setAuthScope: function(authScope) {
			this.authScope = authScope;
			return this;
		},

		/**
		 * Set Callback URL
		 * @param url
		 * @returns {mapillaryUtils}
		 */
		setCallbackUrl: function(url) {
			this.callbackUrl = url;
			return this;
		},

		/**
		 * Authenticate
		 * @param popup Use popup or redirect user
		 */
		authenticate: function() {
			var currentUrlQuery = ioQuery.queryToObject(window.global.location.href),
				popup = this.callbackUrl && this.callbackUrl.match('oauth-callback.html');

			if (authDef)
				authDef.reject({}); //soft rejection
			authDef = new Deferred();

			if (currentUrlQuery.access_token) {
				this.setAuthToken(currentUrlQuery.access_token);
				authDef.resolve({
					access_token: currentUrlQuery.access_token
				});
				return authDef.promise;
			}

			if (!popup) {
				window.global.location = 'https://www.mapillary.com/connect?scope=' + this.authScope + '&client_id=' + this.clientId + '&redirect_uri=' + this.callbackUrl + '&state=return&response_type=token';
			} else {
				var w = 800,
					h = 500,
					top = window.global.top.outerHeight / 2 + window.global.top.screenY - ( h / 2),
					left = window.global.top.outerWidth / 2 + window.global.top.screenX - ( w / 2);
				authWindow = window.global.open(
					'https://www.mapillary.com/connect?scope=' + this.authScope + '&client_id=' + this.clientId + '&redirect_uri=' + this.callbackUrl + '&state=return&response_type=token',
					'mapillaryAuth',
					'toolbar=no,scrollbars=no,resizable=no,width=' + w + ',height=' + h + ',top=' + top + ',left=' + left,
					true
				);
				if (authWindow) {
					authWindow.focus();
				} else {
					authDef.reject({
						error: 'Unable to open Mapillary authentication window. Disable popup blocking in browser.'
					});
				}

				/*FIXME Need to detect closing of OAuth popup and reject authDef
				 // 1st try
				 authWindow.onbeforeunload = function() {
					authDef.resolve();
				 };

				 // 2nd
				 on(authWindow, 'beforeunload', function() {
					authDef.resolve();
				 });*/
			}

			return authDef.promise;
		},

		/**
		 * Callback OAuth
		 * @param response
		 */
		callbackOAuth: function(response) {
			if (!authDef)
				return false;

			if (response.error)
				authDef.reject(response);
			else
				authDef.resolve(response);
		},

		/**
		 * Is Authenticated
		 * @returns {*}
		 */
		isAuthenticated: function() {
			return this.getCurrentUser();
		},

		/**
		 * Get Current User
		 * @returns {*}
		 */
		getCurrentUser: function() {
			var def = new Deferred();
			if (!(authDef && authDef.isResolved())) {
				def.reject({
					error: 'Not Authenticated'
				});
				return def.promise;
			}
			if (currentUser)
				def.resolve(currentUser);
			this._request('https://a.mapillary.com/v3/me').then(function(user) {
				currentUser = user;
				console.log('MapillaryUtils::getCurrentUser', currentUser);
				def.resolve(currentUser);
			}, function(err) {
				console.error('MapillaryUtils::getCurrentUser', err);
				def.reject(err);
			});
			return def.promise;
		},

		/**
		 * Get User
		 * @param userKey
		 * @returns {*}
		 */
		getUser: function(userKey) {
			return this._request('https://a.mapillary.com/v3/users/' + userKey);
		},

		/**
		 * Get User Projects
		 * @param userKey string
		 * @param requestParams object
		 */
		getUserProjects: function(userKey, requestParams) {
			requestParams = requestParams || {};
			console.log('MapillaryUtils::getUserProjects', userKey);
			return this._request('https://a.mapillary.com/v3/users/' + userKey + '/projects', lang.mixin({}, requestParams || {}));
		},

		/**
		 * Look at Point
		 * @param point
		 * @param filter
		 */
		lookAtPoint: function(point, filter) {
			filter = filter || {};
			var requestOptions = {
				'closeto': point.x.toFixed(10) + ',' + point.y.toFixed(10),
				'lookat': point.x.toFixed(10) + ',' + point.y.toFixed(10),
				'radius': 2000
			};
			requestOptions = this._filterRequestOptions(requestOptions, filter);

			if (filter.projectId && filter.projectId !== 'public')
				requestOptions.project_keys = filter.projectId;

			console.log('mapillaryUtils::lookAtPoint', point, requestOptions);
			return this._request('https://a.mapillary.com/v3/images', requestOptions);
		},

		/**
		 * Image Search
		 * @param filter
		 *  bbox	        number[]	Filter by the bounding box, given as  minx,miny,maxx,maxy.
		 *  closeto	        number[]	Filter by a location that images are close to, given as  longitude,latitude.
		 *  end_time	    Date	    Filter images that are captured before  end_time.
		 *  lookat	        number[]	Filter images that images are taken in the direction of the specified location given as  longitude,latitude.
		 *  project_keys	Key[]	    Filter images by projects, given as project keys.
		 *  radius	        number      Filter images within the radius around the  closeto location (default  100 meters).
		 *  start_time	    Date    	Filter images that are captured since  start_time.
		 *  userkeys	    Key[]	    Filter images captured by users, given as user keys.
		 *  usernames	    string[]	Filter images captured by users, given as usernames.
		 * @returns {*}
		 */
		imageSearch: function(filter) {
			filter = filter || {};
			var def = new Deferred(),
				requestOptions = {
					per_page: filter.per_page || filter.max || 200
				},
				nextLink,
				results = [];

			if (this.filterDef)
				this.filterDef.cancel();
			this.filterDef = def.promise;

			for (var i in filter) {
				if (filter.hasOwnProperty(i) && ['bbox','closeto','end_time','lookat','project_keys','radius','start_time','userkeys','usernames'].indexOf(i) > -1)
					requestOptions[i] = filter[i];
			}
			if (filter.projectId && filter.projectId !== 'public')
				requestOptions.project_keys = filter.projectId;

			requestOptions = this._filterRequestOptions(requestOptions, filter);
			console.log('mapillaryUtils::imageSearch', requestOptions);

			async.doUntil(lang.hitch(this, function(callback) {
				if (this.requestDef && !this.requestDef.isFulfilled()) {
					this.requestDef.cancel();
				}
				if (nextLink) {
					var query = ioQuery.queryToObject(nextLink);
					if (query)
						requestOptions = lang.mixin(requestOptions, query);
				}
				this.requestDef = this._request('https://a.mapillary.com/v3/images', requestOptions).then(lang.hitch(this, function(res) {
					results = results.concat(res.features);
					// clear nextLink if at max
					if (filter.max && (results.length >= filter.max))
						nextLink = null;
					else
						nextLink = res.nextLink;
					callback(null, res);
				}), function(err) {
					nextLink = null;
					callback(err);
				});
			}), function() { return !nextLink; }, lang.hitch(this, function done(err) {
				if (err)
					def.reject(err);
				else {
					def.resolve({
						type: "FeatureCollection",
						features: results
					});
				}
			}));
			return def.promise;
		},

		/**
		 * User Fuzzy Search
		 * @param username string
		 * @param requestParams object
		 */
		userFuzzySearch: function(username, requestParams) {
			requestParams = requestParams || {};
			return this._request('https://a.mapillary.com/v3/model.json', lang.mixin({
				paths: JSON.stringify([
					["userFuzzySearch", username, {"from": 0, "to": username.length},
						["avatar", "key", "username"]]
				]),
				method: 'get'
			}, requestParams)).then(lang.hitch(this, function(userResults) {
				var users = [];
				for (var user in userResults.jsonGraph.userFuzzySearch[username]) {
					if (userResults.jsonGraph.userFuzzySearch[username].hasOwnProperty(user))
						users.push(userResults.jsonGraph.userFuzzySearch[username][user].username.value);
				}
				return this._request('https://a.mapillary.com/v3/users', lang.mixin({
					usernames: users.join(','),
					method: 'get'
				}, requestParams));
			})).then(lang.hitch(this, function(result) {
				var def = new Deferred();
				def.resolve(result);
				return def.promise;
			}));
		},

		/**
		 * Feed Items By User Key
		 * @param userKey string
		 * @param requestParams object
		 */
		feedItemsByUserKey: function(userKey, requestParams) {
			requestParams = requestParams || {};
			return this._request('https://a.mapillary.com/v3/model.json', lang.mixin({
				paths: JSON.stringify([
					[
						"feedItemsByUserKey",
						userKey,
						{"from": 0, "to": userKey.length},
						["action_type", "closed", "closed_at", "key", "nbr_objects", "object_type", "objects", "shape", "started_at", "subject_id", "subject_type", "updated_at"]
					]
				]),
				method: 'get'
			}, requestParams));
		},

		/**
		 * Image Close To
		 * @param point
		 * @param filter
		 * @param requestParams
		 * @returns {*}
		 */
		imageCloseTo: function(point, filter, requestParams) {
			requestParams = requestParams || {};
			return this._request('https://a.mapillary.com/v3/model.json', lang.mixin({
				paths: JSON.stringify([
					[
						"imageCloseTo", point.x.toFixed(10) + ':' + point.y.toFixed(10),
						["atomic_scale", "c_rotation", "ca", "calt", "captured_at", "cca", "cfocal", "cl", "gpano", "height", "key", "l", "merge_cc", "merge_version", "orientation", "project", "sequence", "user", "width"],
						["key", "username"]
					]
				]),
				method: 'get'
			}, requestParams));
		},

		/**
		 * Image By User Key
		 * @param imageKey string
		 * @param requestParams object
		 */
		imageByKey: function(imageKey, requestParams) {
			requestParams = requestParams || {};
			return this._request('https://a.mapillary.com/v3/model.json', lang.mixin({
				paths: JSON.stringify([
					[
						[
							"imageByKey",
							imageKey,
							["atomic_scale", "c_rotation", "ca", "calt", "captured_at", "cca", "cfocal", "cl", "gpano", "height", "key", "l", "merge_cc", "merge_version", "orientation", "project", "sequence", "user", "width"],
							["key", "username"]
						]
					]
				]),
				method: 'get'
			}, requestParams));
		},

		/**
		 * Sequence By User Key
		 * @param sequenceKey string
		 * @param requestParams object
		 */
		sequenceByKey: function(sequenceKey, requestParams) {
			requestParams = requestParams || {};
			return this._request('https://a.mapillary.com/v3/model.json', lang.mixin({
				paths: JSON.stringify([
					[
						[
							"sequenceByKey",
							sequenceKey,
							"keys"
						]
					]
				]),
				method: 'get'
			}, requestParams));
		},

		/**
		 * Get Viewer
		 * @returns {Mapillary.Viewer}
		 */
		getViewer: function(domId) {
			if (this.mapillary && this.mapillary[domId])
				return this.mapillary[domId];

			if (!this.mapillary)
				this.mapillary = {};
			this.mapillary[domId] = new Mapillary.Viewer(
				domId,
				this.clientId,
				null,
				{
					renderMode: Mapillary.RenderMode.Fill,
					component: {
						mouse: {
							doubleClickZoom: false
						},
						mapillaryObjects: false,
						marker: true,
						cover: false,
						detection: true,
						attribution: true,
						direction: {
							distinguishSequence: true,
							maxWidth: 460,
							minWidth: 180
						},
						imagePlane: {
							imageTiling: true
						},
						stats: true
					}
				}
			);
			if (authToken)
				this.mapillary[domId].setAuthToken(authToken);
			return this.mapillary[domId];
		},

		/**
		 * Destroy Viewer
		 * @param domId
		 */
		destroyViewer: function(domId) {
			this.mapillary && this.mapillary[domId] && delete this.mapillary[domId];
		},

		/**
		 * Create mapillary Coverage Layer
		 * @returns {VectorTileLayer}
		 */
		createMapillaryCoverageLayer: function() {
			this.publicLayers = new VectorTileLayer(this.layersJson, {id: 'Mapillary'});
			return this.publicLayers;
		},

		/**
		 * Create mapillary Coverage Layer
		 * @returns {VectorTileLayer}
		 */
		createMapillaryProjectCoverageLayer: function() {
			if (this.clientId && !this.projectLayersJson.sources['mapillary-source'].tiles[0].match(/client_id/))
				this.projectLayersJson.sources['mapillary-source'].tiles[0] = this.projectLayersJson.sources['mapillary-source'].tiles[0] + (this.projectLayersJson.sources['mapillary-source'].tiles[0].match(/\?/) ? '&' : '?') + 'client_id=' + this.clientId;
			if (authToken && !this.projectLayersJson.sources['mapillary-source'].tiles[0].match(/token/))
				this.projectLayersJson.sources['mapillary-source'].tiles[0] = this.projectLayersJson.sources['mapillary-source'].tiles[0] + (this.projectLayersJson.sources['mapillary-source'].tiles[0].match(/\?/) ? '&' : '?') + 'token=' + authToken;

			this.projectLayers = new VectorTileLayer(this.projectLayersJson, {id: 'Mapillary_Projects'});
			return this.projectLayers;
		},

		/**
		 * Create Mapillary Objects Layer
		 * @returns {VectorTileLayer}
		 */
		createMapillaryObjectsLayer: function() {
			if (this.clientId && !this.vectorLayerJson.sources.mapillaryvector.tiles[0].match(/client_id/))
				this.vectorLayerJson.sources.mapillaryvector.tiles[0] = this.vectorLayerJson.sources.mapillaryvector.tiles[0] + (this.vectorLayerJson.sources.mapillaryvector.tiles[0].match(/\?/) ? '&' : '?') + 'client_id=' + this.clientId;
			if (authToken && !this.vectorLayerJson.sources.mapillaryvector.tiles[0].match(/token/))
				this.vectorLayerJson.sources.mapillaryvector.tiles[0] = this.vectorLayerJson.sources.mapillaryvector.tiles[0] + (this.vectorLayerJson.sources.mapillaryvector.tiles[0].match(/\?/) ? '&' : '?') + 'token=' + authToken;
			this.objectLayer = new VectorTileLayer(
				this.vectorLayerJson,
				{id: 'Mapillary_Traffic_Signs'});
			return this.objectLayer;
		}
	};
});