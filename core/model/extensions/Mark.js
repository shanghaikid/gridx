define([
	'dojo/_base/declare',
	'dojo/_base/lang',
	'dojo/_base/array',
	'dojo/aspect',
	/*====='../Model',=====*/
	'../_Extension'
], function(declare, lang, array, aspect,
	/*=====Model, =====*/
	_Extension){

/*=====
	Model.getMark = function(){};
	Model.getMarkedIds = function(){};
	Model.markById = function(){};
	Model.markByIndex = function(){};
	Model.clearMark = function(){};
	Model.treeMarkMode = function(){};
	Model.onMarkChange = function(){};
	Model.setMarkable = function(){};

	return declare(_Extension, {
		// summary:
		//		Provide a marking system, mainly used by selection.
	});
=====*/

	return declare(_Extension, {
		name: 'mark',

		priority: 5,
		
		constructor: function(model, args){
			var t = this;
			t.mixed = 'mixed';
			t.states = {
				0: false,
				1: t.mixed,
				2: true
			};
			t.clear();
			t._tree = {};
			t._mixinAPI('getMark', 'getMarkedIds', 'markById', 'markByIndex', 'clearMark', 'treeMarkMode', 'setMarkable', 'getIdByVisualId');
			t.aspect(model, '_msg', '_receiveMsg');
			t.aspect(model._cache, 'onLoadRow', '_onLoadRow');
			t.aspect(model, 'setStore', 'clear');
			model.onMarkChange = function(){};
			model._spTypes = {};

			t.serverMode = args.markServerMode;

			// build selection cache
			t._buildSelectionCache();
		},

		_buildSelectionCache: function() {
			var t = this,
				s = t.model.store,
				selectCache = t._byId.select = t._byId.select ? t._byId.select : {};

			// cache full id list 
			t._ids = [];

			// if we are in server mode, get full id list from server
			if (t.serverMode) {
				aspect.around(t.model.store, "_xhrFetchHandler", function(oldFn) {
					return function(data) {
						if (data.ids) {
							for (var i = 0, len = data.ids.length; i < len; i++) {
								selectCache[data.ids[i]] = selectCache[data.ids[i]] !== undefined ?  selectCache[data.ids[i]] : 0;
								t._ids[i] = data.ids[i];
							}
						}

						oldFn.apply(t.model.store, arguments);
					};
				});
			}
		},

		getIdByVisualId: function(vId) {
			return this._ids[vId] !== undefined ? this._ids[vId] : -1;
		},

		//Public------------------------------------------------------------------
		clear: function(){
			this._byId = {};
			this._last = {};
			this._lazy = {};
			this._unmarkable = {};
		},

		setMarkable: function(rowId, markable, type){
			type = this._initMark(type);
			var t = this,
				m = t.model,
				mm = m._model,
				unmarkable = this._unmarkable,
				hash = unmarkable[type] = unmarkable[type] || {};
				
			hash[rowId] = !markable;
			
			if(markable){
				var children = mm._call('children', [rowId]),
					mark;
				if(children.length){	//if has child, let the first child setMark 
										//to its current mark value to regenerate the mark tree
					var c = children[0];
					mark = this._byId[this._initMark(type)][c] || 0;

					this._doMark(c, type, mark);
				}else{
					
					var pid = mm._call('parentId', [rowId]);
					mark = this._byId[this._initMark(type)][pid] || 0;

					this._doMark(pid, type, mark);
				}
			}

		},

		clearMark: function(type){
			this._byId[this._initMark(type)] = {};
		},

		getMarkedIds: function(type, includePartial){
			var t = this,
				ret = [], id,
				tp = t._initMark(type),
				ids = t._byId[tp];
			if(ids){
				for(id in ids){
					if(includePartial || ids[id] == 2){
						ret.push(id);
					}
				}
			}
			return ret;
		},

		isMarked: function(id, type){
			type = this._initMark(type);
			var state = this._byId[type][id];
			return state == 2;
		},

		isPartialMarked: function(id, type){
			return this._byId[this._initMark(type)][id] == 1;
		},

		getMark: function(id, type){
			var m = this._byId[this._initMark(type)][id] || 0;
			return {
				0: false,
				1: this.mixed,
				2: true
			}[m];
		},

		markById: function(id, toMark, type){
			this._cmd(id, toMark, type, 1); //Should we make this sync?
		},

		markByIndex: function(index, toMark, type, parentId){
			if(index >= 0 && index < Infinity){
				this._cmd(index, toMark, type, 0, parentId);
			}
		},

		treeMarkMode: function(type, toEnable){
			type = this._initMark(type);
			var tm = this._tree;
			return toEnable === undefined ? tm[type] : (tm[type] = toEnable);
		},
		
		//Private----------------------------------------------------------------
		_cmdMark: function(){
			var t = this,
				args = arguments,
				ranges = [],
				m = t.model._model;
			array.forEach(args, function(arg){
				if(!arg[3]){
					ranges.push({
						start: arg[0],
						count: 1
					});
				}
			});

			// if we are in server mode
			// select id from the selection cache
			// otherwise, use gridx approach
			if (t.serverMode) {
				t.__cmdMark(args);
			} else {
				return m._call('when', [{
					id: [],
					range: ranges
				}, lang.hitch(t, t.__cmdMark, args)]);
			}
		},

		__cmdMark: function(args) {
			var t = this;

			array.forEach(args, function(arg){
				var id = arg[3] ? arg[0] : t._indexToId(arg[0], arg[4]),
					toMark = arg[1],
					type = t._initMark(arg[2]);
				if(toMark === t.mixed){
					toMark = 1;
				}else if(toMark){
					toMark = 2;
				}else{
					toMark = 0;
				}
				if(t.model.isId(id) && t._isMarkable(type, id)){
					t._mark(id, toMark, type);
				}
			});
		},

		// local indexToId
		// if we are in server mode, return id from local selection cache
		// if we are in local mode, use gridx approach
		_indexToId: function(index, parentId) {
			if (!this.serverMode) return this.inner._call('indexToId', arguments);

			return this._ids[index];
		},

		_onDelete: function(id, rowIndex, treePath){
			var t = this,
				tp,
				byId = t._byId,
				last = t._last,
				lazy = t._lazy;
			for(tp in byId){
				tp = t._initMark(tp);
				delete byId[tp][id];
				delete last[tp][id];
				delete lazy[tp][id];
				if(treePath){
					t._updateParents(treePath, tp);
				}
			}
			t.onDelete.apply(t, arguments);
		},

		_initMark: function(type){
			var t = this,
				c = t._byId,
				s = t._last,
				z = t._lazy,
				tp = type || 'select';
			c[tp] = c[tp] || {};
			z[tp] = z[tp] || {};
			s[tp] = s[tp] || {};
			return tp;
		},

		_cmd: function(){
			this.model._addCmd({
				name: "_cmdMark",
				scope: this,
				args: arguments,
				async: 1
			});
		},

		_receiveMsg: function(msg, filteredIds){
			if(msg == 'filter'){
				var t = this,
					tp, id,
					sp = t.model._spTypes;
				for(tp in sp){
					if(sp[tp]){
						for(id in t._byId[tp]){
							if(array.indexOf(filteredIds, id) < 0){
								//Do not fire event since now is still during filter.
								t._doMark(id, tp, 0, 0, 1);
							}
						}
					}
				}
			}
		},

		///////////////////////////////////////////////////////////////////////////////////////////////
		_mark: function(id, toMark, type){
			var t = this,
				tp = t._initMark(type),
				state = t._byId[tp][id] || 0;
			if(t.model.isId(id) && state != toMark){
				t._doMark(id, tp, toMark);
			}
		},

		_onLoadRow: function(id){
			var t = this,
				m = t.model,
				mm = m._model,
				lazy = t._lazy,
				type, lz, flag,
				pid = mm._call('treePath', [id]).pop();
			if(m.isId(pid)){
				for(type in lazy){
					lz = lazy[type];
					flag = lz[pid];
					if(typeof flag == 'number'){
						flag = lz[pid] = {
							toMark: flag,
							count: mm._call('size', [pid])
						};
					}
					if(flag){
						--flag.count;
						if(!flag.count){
							delete lz[pid];
						}
						t._doMark(id, type, flag.toMark, 1);
					}
				}
			}
		},

		_fireEvent: function(id, type, toMark, oldState){
			var t = this,
				m = t.model;
			if(toMark != oldState){
				if(!toMark){
					delete t._byId[type][id];
				}
				m.onMarkChange(id, t.states[toMark || 0], t.states[oldState || 0], type);
			}
		},

		_updateParents: function(treePath, type, noEvent){
			var t = this,
				mm = t.model._model,
				byId = t._byId[type],
				last = t._last[type];
			for(var i = treePath.length - 1; i > 0; --i){
				var pid = treePath[i],
					oldState = byId[pid],
					siblings = mm._call('children', [pid]),
					markCount = array.filter(siblings, function(childId){
						return last[childId] = byId[childId];
					}).length,
					fullCount = array.filter(siblings, function(childId){
						return byId[childId] == 2;
					}).length;
				// if(t._isMarkable(type, pid)){
				if(fullCount != 0 && fullCount == siblings.length && oldState != 2){
					byId[pid] = 2; //none|partial -> all
				}else if(!markCount && oldState){
					delete byId[pid]; //all|partial -> none
				}else if(markCount && fullCount < siblings.length && oldState != 1){
					byId[pid] = 1; //all|none -> partial
				}
				if(!noEvent){
					t._fireEvent(pid, type, byId[pid], oldState);
				}
			}
		},

		_doMark: function(id, tp, toMark, skipParent, noEvent){
			var i, ids, children, childId, treePath,
				t = this,
				m = t.model,
				mm = m._model,
				byId = t._byId[tp],
				last = t._last[tp],
				lazy = t._lazy[tp],
				// selectable = t._byId['selectable'],
				oldState = byId[id] || 0,
				newState;
			if(t._tree[tp]){
				children = mm._call('children', [id]);
				if(toMark == 1 && array.every(children, function(childId){
					return (last[childId] || 0) == (last[children[0]] || 0);
				})){
					toMark = 2;
				}
			}
			byId[id] = last[id] = toMark;
			if(!noEvent){
				t._fireEvent(id, tp, toMark, oldState);
			}
			if(t._tree[tp]){
				ids = [id];
				while(ids.length){
					childId = ids.shift();
					oldState = byId[childId] || 0;
					newState = byId[childId] = toMark == 1 ? last[childId] || 0 : toMark;
					if(!noEvent){
						t._fireEvent(childId, tp, newState, oldState);
					}
					if(mm._call('hasChildren', [childId])){
						children = mm._call('children', [childId]);
						if(children.length){
							ids = ids.concat(children);
						}else{
							lazy[childId] = toMark;
						}
					}
				}
				if(!skipParent){
					treePath = mm._call('treePath', [id]);
					t._updateParents(treePath, tp, noEvent);
				}
			}
		},

		_isMarkable: function(tp, id){
			return this._unmarkable[tp] ? !this._unmarkable[tp][id] : true;
		}
	});
});
