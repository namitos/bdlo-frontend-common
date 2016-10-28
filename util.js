'use strict';

(function (module) {
	var util = {
		queryString: function (a) {
			function buildParams(prefix, obj, add) {
				var name, i, l, rbracket;
				rbracket = /\[\]$/;
				if (obj instanceof Array) {
					for (i = 0, l = obj.length; i < l; i++) {
						if (rbracket.test(prefix)) {
							add(prefix, obj[i]);
						} else {
							buildParams(prefix + "[" + ( typeof obj[i] === "object" ? i : "" ) + "]", obj[i], add);
						}
					}
				} else if (typeof obj == "object") {
					// Serialize object item.
					for (name in obj) {
						buildParams(prefix + "[" + name + "]", obj[name], add);
					}
				} else {
					// Serialize scalar item.
					add(prefix, obj);
				}
			}

			var prefix, s, add, name, r20, output;
			s = [];
			r20 = /%20/g;
			add = function (key, value) {
				// If value is a function, invoke it and return its value
				value = ( typeof value == 'function' ) ? value() : ( value == null ? "" : value );
				s[s.length] = encodeURIComponent(key) + "=" + encodeURIComponent(value);
			};
			if (a instanceof Array) {
				for (name in a) {
					add(name, a[name]);
				}
			} else {
				for (prefix in a) {
					buildParams(prefix, a[prefix], add);
				}
			}
			output = s.join("&").replace(r20, "+");
			return output;
		},
		strFormat: function (str, format) {
			var formats = {
				sn: function (str) {
					return str.toString().replace(/(\d)(?=(\d\d\d)+([^\d]|$))/g, '$1 ');
				},
				phone: function (str) {
					return str.replace('+', '').replace(/(\d{1})(\d{3})(\d{3})(\d{2})(\d{2})/, "+$1 ($2) $3-$4-$5");
				},
				phoneLink: function (str) {
					return 'tel:' + str;
				},
				date: function (date) {
					return moment(date).format('DD.MM.YYYY');
				},
				dateTime: function (date) {
					return moment(date).format('DD.MM.YYYY HH:mm');
				},
				time: function (date) {
					return moment(date).format('HH:mm');
				},
				calendar: function (date) {
					return moment(date).calendar();
				}
			};
			return formats[format](str);
		},
		notify: function (data, duration) {
			var el = util.dom.el('paper-toast', {
				attributes: {
					duration: duration || 10000
				}
			}, data instanceof Object ? data.body : data);
			document.body.appendChild(el);
			setTimeout(function () {
				el.show();
			}, 100);
		},
		init: function () {
			window.socket = io();
			return Promise.all([
				new Promise(function (resolve, reject) {
					socket.emit('data:schemas', {}, function (result) {
						try {
							var data;
							eval('data = ' + result);
							window.schemas = data;
							Object.keys(schemas).forEach(function (key) {
								schemas[key] = new Schema(schemas[key]);
								schemas[key].forEach(function (schemaPart) {
									if (schemaPart.widget == 'base64File') {
										schemaPart.type = 'any';//костыль для фронтенда, чтоб файловый инпут работал, а на бекенде хранило точно по схеме
									}
									if (schemaPart.widget1 == 'base64Image') {//fixme костыль, который призван в некоторых случаях перебивать название виджета.
										schemaPart.widget = 'base64Image';
									}
								});
							});
							resolve();
						} catch (e) {
							console.error(e);
							reject();
						}
					});
				}),
				new Promise(function (resolve, reject) {
					socket.emit('currentUser', {}, function (user) {
						window.user = new User(user);
						resolve();
					});
				})
			])
		},
		modalForm: function (name, schema, obj, cb, cbChange, saveCaption) {
			var el = util.dom.el('ui-dialog', {
				name: name
			}, util.dom.form(schema, obj, function () {
				cb();
				el.close();
			}, cbChange, saveCaption));
			document.body.appendChild(el);
			el.open();
			return el;
		},
		dom: {
			el: function (name, properties, children) {
				properties = properties || {};
				var el = document.createElement(name);
				if (properties.attributes) {
					for (var key in properties.attributes) {
						el.setAttribute(key, properties.attributes[key]);
					}
					delete properties.attributes;
				}
				for (var key in properties) {
					el[key] = properties[key];
				}
				if (children) {
					if (typeof children == 'string') {
						el.innerHTML = children;
					} else if (children instanceof Array) {
						children.forEach(function (item) {
							Polymer.dom(el).appendChild(item);
						});
					} else {
						Polymer.dom(el).appendChild(children);
					}
				}
				return el;
			},
			form: function (schema, obj, cb, cbChange, saveCaption) {
				var fields = fc(schema, obj);
				fields.appendChild(util.dom.el('button', {
					type: 'submit',
					attributes: {
						nostyle: true
					}
				}, util.dom.el('paper-button', {
					raised: true
				}, saveCaption || 'Сохранить')));
				var form = util.dom.el('form', {}, fields);
				if (cbChange) {
					fields.addEventListener('changeObj', cbChange);
				}
				form.addEventListener('submit', function (e) {
					try {
						if (obj.prepare instanceof Function) {
							obj.prepare();
						}
						var validation = validate(obj, schema);
						if (validation.valid) {
							if (window.disconnectWarning) {
								util.notify('Дождитесь восстановления интернета и попытайтесь снова');
							} else {
								cb.call(this, e);
							}
						} else {
							//второй уровень валидации для тех, кто не поддерживает html5 validation, и для conform
							//todo потом вынести в методы класса схемы
							var validationToText = function (error) {
								var attrs = {
									required: 'должно быть заполнено',
									allowEmpty: 'должно быть заполнено'
								};
								if (attrs[error.attribute]) {
									return attrs[error.attribute];
								} else if (error.attribute == 'conform') {
									return error.message;
								} else {
									console.error(error);
									return 'должно быть заполнено правильно';
								}
							};

							if (schema instanceof Schema) {
							} else {
								schema = new Schema(schema);
							}
							var errors = [];
							validation.errors.forEach(function (error) {
								try {
									errors.push(schema.getField(error.property, 'label') + ' ' + validationToText(error) + '\n');
								} catch (err) {
									console.error(err, error);
								}
							});
							console.log(errors);
							util.notify(errors.join('; '));
						}
					} catch (err) {
						console.log(err);
					}

					e.preventDefault();
				});
				return form;
			},
			modalForm: function () {
				util.modalForm.apply(this, arguments);
				console.error('util.dom.modalForm deprecated, use util.modalForm!!!');
			}
		}
	};
	
	module.util = util;

	module.fc.widgets.selectCollection = function (obj, schema) {
		var el = util.dom.el('div');
		var input = util.dom.el('select', {}, util.dom.el('option'));
		var StructureClass = eval(schema.model);
		StructureClass.read().then(function (items) {
			if (schema.filter instanceof Function) {
				items = items.filter(schema.filter);
			}
			if (schema.sort instanceof Function) {
				items = items.sort(schema.sort);
			}
			items.forEach(function (item) {
				var str = item.name || item.shortname || item.shortName || item.short_name || item.fullname || item.fullName || item.full_name || item.title.toString() || item.text || item.value || item.alias || item._id;
				var el = util.dom.el('option', {
					attributes: {
						value: item._id
					}
				}, str.toString());
				if (item._id == obj) {
					el.setAttribute('selected', true);
				}
				input.appendChild(el);
			});
		}).catch(err);
		el.appendChild(input);
		return {
			wrapper: el,
			input: input
		}
	};

	module.fc.widgets.base64Image = function (obj, schema) {
		var el = util.dom.el('div');
		var input = util.dom.el('fc-input-image', {
			value: obj
		});
		el.appendChild(input);
		return {
			wrapper: el,
			input: input
		}
	};

	module.fc.widgets.unixDateTime = function (obj, schema) {
		if (window.moment) {
			var el = util.dom.el('div');
			var input = util.dom.el('input', {
				attributes: {
					type: 'datetime-local'
				}
			});
			el.appendChild(input);
			input.value = obj ? moment(obj).format("YYYY-MM-DDTHH:mm") : '';
			input.convertValue = function (value) {
				return value ? moment(value, "YYYY-MM-DDTHH:mm").toDate().valueOf() : 0;
			};
			return {
				wrapper: el,
				input: input
			}
		} else {
			console.error('unixDateTime widget requires momentjs');
		}
	};
})(this);
