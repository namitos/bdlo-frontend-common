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
			return Promise.all([
				new Promise(function (resolve, reject) {
					document.addEventListener('WebComponentsReady', function () {
						resolve();
					});
				}),
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
			var el = util.dom.el('ui-dialog', {}, [
				util.dom.el('h2', {}, name),
				util.dom.form(schema, obj, function () {
					cb();
					el.close();
				}, cbChange, saveCaption)
			]);
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
					type: 'submit'
				}, saveCaption || 'Сохранить'));
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
							var errors = [util.dom.el('div', {}, 'Ошибки в заполнении формы')];

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

							validation.errors.forEach(function (error) {
								try {
									errors.push(util.dom.el('div', {}, schema.getField(error.property, 'label') + ' ' + validationToText(error)));
								} catch (err) {
									console.error(err, error);
								}
							});
							util.notify(errors);
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
})(this);
