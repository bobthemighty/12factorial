var consul = require ('consul')({ promisify: true })
var events = require('events');

function _Value(opts) {
  this.opts = opts;

  this.apply = function (path, key, target, builderOpts) {
    var varname = path.concat([key]);
    var prefixed = path.concat([key]);
    varname = varname.join('.');

    if (! this.opts.optional) {
      builderOpts.required[varname] = true;
    }

    if (builderOpts.envPrefix) {
      prefixed.unshift(builderOpts.envPrefix);
    }

    var envValue = process.env[(prefixed.join('_')).toUpperCase()];

    if (envValue !== undefined) {
      target[key] = envValue;
      builderOpts.emitter.emit('change', varname, envValue, undefined);
    } else if (builderOpts.consulPrefix) {
        this.applyConsulWatch(path, key, target, builderOpts);
    } else {
      target[key] = this.opts.default;
      builderOpts.emitter.emit('change', varname, opts.default, undefined);
    }
  }

  this.applyConsulWatch = function (path, key, target, builderOpts) {
    var varname = path.concat([key]).join('.');
    var keyPath = [builderOpts.consulPrefix].concat(path).concat([key]).join('/');
    var watch = consul.watch({ method: consul.kv.get, options: { key: keyPath }});
    var _default = this.opts.default;
    watch.on('change', function(data, res) {
      var prev = target[key];
      if (res.statusCode == 200 && data && data.Value) {
        target[key] = data.Value;
        builderOpts.emitter.emit('change', varname, data.Value, prev);
      } else {
        target[key] = _default;
        builderOpts.emitter.emit('change', varname, _default, prev);
      }
    })
  }
}

function _Service (name, opts) {
  this.opts = opts;
  this.service = name;

  this.apply = function (path, key, target, builderOpts) {
    var addrVar = path.concat([key, 'ADDRESS'])
    var portVar = path.concat([key, 'PORT'])
    var varname = path.concat([key]).join('.');

    if (! this.opts.optional) {
      builderOpts.required[varname] = true;
    }

    if (builderOpts.envPrefix) {
      addrVar.unshift(builderOpts.envPrefix)
      portVar.unshift(builderOpts.envPrefix)
    }

    addrVar = process.env[addrVar.join('_').toUpperCase()]
    portVar = parseInt(process.env[portVar.join('_').toUpperCase()])

    if (addrVar !== undefined && portVar !== undefined) {
      target[key] = new _ServiceValue(addrVar, portVar)
      builderOpts.emitter.emit('change', varname, target[key], undefined);
    } else {
       this.applyConsulWatch(path, key, target, builderOpts)
    }
  }

  this.applyConsulWatch = function (path, key, target, builderOpts) {
    var varname = path.concat([key]).join('.');
    var keyPath = [builderOpts.consulPrefix].concat(path).concat([key]).join('/');
    var watch = consul.watch({ method: consul.catalog.service.nodes, options: { service: this.service }});
    var _default = this.opts.default;
    watch.on('change', function(data, res) {

      var prev = target[key];
      if (res.statusCode == 200 && data) {
        var item = data[Math.floor(Math.random()*data.length)]
        target[key] = new _ServiceValue(item.ServiceAddress, item.ServicePort)
        builderOpts.emitter.emit('change', varname, item, prev);
      } else {
        target[key] = _default;
        builderOpts.emitter.emit('change', varname, _default, prev);
      }
    })
  }
}

function _ServiceValue (address, port) {

  this.port = port
  this.address = address

  this.getAddress = function () {
    return this.address + ':' + this.port
  }

  this.buildUri = function (path) {
    return this.getAddress() + '/' + path
  }
}

function _isObject(o) {
  if(!o) return false;
  if(Array.isArray(o)) return false;
  if(o.constructor != Object) return false;
  return true;
}

function _buildRecursive (target, spec, opts, path) {
  for(var key in spec){
    var val = spec[key]
    if (val instanceof _Value) {
      val.apply(path, key, target, opts);
    } else if (val instanceof _Service) {
      val.apply(path, key, target, opts);
    } else  if (_isObject(val)) {
      target[key] = _buildRecursive({}, spec[key], opts, path.concat([key]));
    }
  }
  return target;
}



module.exports.build = function (spec, opts){
  if (opts === undefined) { opts = {}; }
  opts.emitter = new events.EventEmitter();
  opts.required = {};

  function changeHandler (target, resolve, reject) {
    var _handle = function(name, v, old) {
      console.log(name + " changed from " + old + " to " +v);
      opts.required[name] = false;
      var hasMissing = false;

      for (var val in opts.required) {
        hasMissing |= opts.required[val];
      }
      if(! hasMissing) {
        resolve(target)
      }
    }
    return _handle
  }


  return new Promise(function(resolve, reject) {
    var target = {};
    opts.emitter.on('change', changeHandler(target, resolve, reject));
    _buildRecursive(target, spec, opts || {}, []);
  }).catch(function(e){ console.log(e) });
}

module.exports.value = function (opts){
  return new _Value(opts || {});
}

module.exports.service = function (name, opts) {
  return new _Service(name, (opts || {}));
}
