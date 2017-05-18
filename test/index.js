var consul = require('consul')({promisify: true});
var config = require('../index');

var cfg = {
  value: config.value({optional: true}),
  hardcoded: 'hello world',
  valueWithDefault: config.value({default: 123}),
  nested: {
    value: config.value({optional: true})
  },
  db: {
    credentials: {
      username: config.value({default: 'rootato'})
    }
  }
}

describe('When a field is hard-coded', function () {

  it('should use the static value', function (done) {
    config.build(cfg).then(function(result) {
      expect(result.hardcoded).toBe('hello world');
      done();
    });
  });
});

describe('When an env var is present', function() {

  beforeEach(function() {
    process.env.VALUE = 'tomato'
  });

  it('should be set on the config', function (done) {
    config.build(cfg).then(function(result) {
      expect(result.value).toBe('tomato')
      done();
    });
  });

  afterEach(function () { delete process.env.VALUE });
})

describe('When an env var is present for a nested key', function () {

  beforeEach(function() {
    process.env.NESTED_VALUE = 'potato'
  });

  it('should be set on the config', function (done) {
    config.build(cfg).then(function(result) {
      expect(result.nested.value).toBe('potato');
      done();
    });
  });

  afterEach(function () { delete process.env.NESTED_VALUE });
});

describe('When a value has a default', function () {

  it('should be set on the config', function (done) {
    config.build(cfg).then(function (result) {
      expect(result.valueWithDefault).toBe(123);
      done()
    });
  })

})

describe('When a defaulted value is set by environment variable', function () {

  var result;

  beforeEach(function(done) {
    process.env.DB_CREDENTIALS_USERNAME = 'rootato'
    process.env.VALUEWITHDEFAULT = '999'
    config.build(cfg).then(function (r) {
      result = r;
      done()
    })
  })

  it('should use the environment value', function () {
     expect(result.db.credentials.username).toBe('rootato');
  })

  it('should coerce values to the right type', function () {
    expect(result.valueWithDefault).toBe(999);
  })

  afterEach(function () {
    delete process.env.DB_CREDENTIALS_USERNAME;
    delete process.env.VALUEWITHDEFAULT;
  });
})

describe('When reading an env var for a non-string value', function () {

  var result;

  var _const = function (x) { return function() { return x } };

  var cfg = {
    defaults: {
        number: config.value({ default: 100 }),
        string: config.value({ default: 'hello' }),
        bool: config.value({ default: true }),
        boolUpper: config.value({ default: true })
    },
    readers: {
      number: config.value({ default: 'a string value', reader: parseInt }),
      bool: config.value({ default: 27, reader: _const(true) }),
      string: config.value({ default: 100, reader: String })
    }
  }

  beforeEach(function(done) {

    process.env.DEFAULTS_NUMBER = '179837'
    process.env.READERS_NUMBER = '179837'

    process.env.DEFAULTS_STRING = '179837'
    process.env.READERS_STRING = '179837'

    process.env.DEFAULTS_BOOL = 'false'
    process.env.DEFAULTS_BOOLUPPER = 'FALSE'
    process.env.READERS_BOOL = 'false'

    config.build(cfg).then(function (x) {
      result = x;
      done();
    });
  });


  it('should parse the integers', function () {
    expect(result.defaults.number).toBe(179837)
    expect(result.readers.number).toBe(179837)
  });

  it('should parse the booleans', function () {
    expect(result.defaults.bool).toBe(false)
    expect(result.defaults.boolUpper).toBe(false)
    expect(result.readers.bool).toBe(true)
  });

  it('should not parse the strings', function () {
    expect(result.defaults.string).toBe('179837')
    expect(result.readers.string).toBe('179837')
  })
});


describe('When a prefix is set', function () {

  beforeEach(function() {
    process.env.MYAPP_DB_CREDENTIALS_USERNAME = 'sausages'
  })

  it('should use the environment value', function (done) {
    config.build(cfg, {envPrefix: 'myapp'}).then(function (result) {
      expect(result.db.credentials.username).toBe('sausages');
    }).then(done);
  })

  afterEach(function () { delete process.env.MYAPP_DB_CREDENTIALS_USERNAME });
})

describe('When a value is present in consul', function () {

  var consulCfg = {
    value: config.value()
  }

  it('should use the value from consul', function(done) {
    config.build(consulCfg, {consul: {prefix: 'myapp'}})
      .then(function (result){
        expect(result.value).toBe('saussignac');
        done();
      });
  })
})

describe('When a value is missing in consul but has a default', function () {

  var consulCfg = {
    value: config.value({default: 'fluster'})
  }

  it('should use the value from consul', function(done) {
    config.build(consulCfg, {consul: {prefix: 'myotherapp'}})
      .then(function (result){
        expect(result.value).toBe('fluster');
        done();
      });
  })
})


describe('When a service is defined by env vars', function () {

  var cfg = {
    db: config.service('12factorial-test')
  }

  beforeEach(function() {
    process.env.DB_ADDRESS = '10.128.64.32'
    process.env.DB_PORT = 5432
  })

  it('should be able to return the address', function (done) {
    config.build(cfg).then(function (result) {
      expect(result.db.getAddress()).toBe('10.128.64.32:5432')
    }).then(done);
  })

  it('should be able to return the port', function (done) {
    config.build(cfg).then(function (result) {
      expect(result.db.port).toBe(5432);
    }).then(done);
  })

  it('should be able to return the address', function (done) {
    config.build(cfg).then( function(result) {
      expect(result.db.address).toBe('10.128.64.32');
    }).then(done);
  })

  it('should be able to build a uri', function (done) {
    config.build(cfg).then(function(result) {
      expect(result.db.buildUri('foo')).toBe('10.128.64.32:5432/foo');
    }).then(done);
  })

  afterEach(function () {
    delete process.env.DB_ADDRESS;
    delete process.env.DB_PORT;
  });
})

describe('When a service is present in consul', function () {

  var cfg = {
    myservice: config.service('12factorial-test')
  }

  var result;

  beforeEach(function (done) {
    consul.agent.service.register({
      id: "12factorial-test",
      name: "12factorial-test",
      address: "10.128.64.32",
      port: 1234
    }).then(function() {
      return config.build(cfg);
    }).then(function (v) { result = v; done();}).catch(function (e) { console.log("HITE", e) });
  });

   it('should be able to return the address', function () {
    expect(result.myservice.getAddress()).toBe('10.128.64.32:1234')
  })

  it('should be able to return the port', function () {
    expect(result.myservice.port).toBe(1234)
  })

  it('should be able to return the address', function () {
    expect(result.myservice.address).toBe('10.128.64.32')
  })

  it('should be able to build a uri', function () {
    expect(result.myservice.buildUri('foo')).toBe('10.128.64.32:1234/foo')
  })

})

describe('When consul is not reachable but values are present in the environment', function () {

  var cfg = {
    myvalue: config.value(),
    myservice: config.service('foo')
  };

  var result;

  beforeEach(function (done) {

    process.env.MYVALUE = 'frustrum';
    process.env.MYSERVICE_ADDRESS = '10.128.8.21';
    process.env.MYSERVICE_PORT = 8401;
    process.env.MYVALUE = 'frustrum';

    config.build(cfg, { consul: {
      host: 'not-a-real-host.local',
      prefix: 'myservice'
    }}).then(function(v) {
      result = v;
      done();
    });
  });

  it('Should return a complete config object', function () {
    expect(result.myvalue).toBe('frustrum');
    expect(result.myservice.port).toBe(8401);
    expect(result.myservice.address).toBe('10.128.8.21');
  });

  afterEach(function () {
    delete process.env.MYVALUE;
    delete process.env.MYSERVICE_ADDRESS;
    delete process.env.MYSERVICE_PORT;
  });
});

describe('When extending a service', function () {

  var cfg = {
    myservice: config.service('12factorial-extension-test').extend({
        password: config.value({sensitive: true}),
        username: config.value()
    })
  };

  describe('When vars are available in the environment', function () {

    var result;

    beforeEach(function (done) {

      process.env.MYSERVICE_USERNAME = 'rubidium';
      process.env.MYSERVICE_PASSWORD = 'babylonian';
      process.env.MYSERVICE_ADDRESS = '10.128.8.22';
      process.env.MYSERVICE_PORT = 8901;

      config.build(cfg).then(function(v) {
        result = v;
        done();
      }).catch(function(e){ console.log(e);  });
    });


    it('Should have fetched the service vars', function () {
      expect(result.myservice.getAddress()).toBe('10.128.8.22:8901')
    });

    it('Should have set the password', function () {
      expect(result.myservice.password).toBe('babylonian')
    });

    it('Should have set the username', function () {
      expect(result.myservice.username).toBe('rubidium')
    });

    afterEach(function () {
      delete process.env.MYSERVICE_USERNAME;
      delete process.env.MYSERVICE_PASSWORD;
      delete process.env.MYSERVICE_ADDRESS;
      delete process.env.MYSERVICE_PORT;
    });
  });

  describe('When vars are available in consul', function () {

    var result;

    beforeEach(function (done) {
      process.env.MYSERVICE_PASSWORD = 'babylonian';
      consul.agent.service.register({
        id: "12factorial-extension-test",
        name: "12factorial-extension-test",
        address: "10.128.31.32",
        port: 9876
      }).then(function() {
       return consul.kv.set('12factorial/myservice/username', 'copper king')
      }).then(function () {
        return config.build(cfg, { consul:{ prefix: '12factorial' }});
      }).then(function(v) {
        result = v;
        done();
      }).catch(function(e){ console.log(e);  });
    });


    it('Should have fetched the service vars', function () {
      expect(result.myservice.getAddress()).toBe('10.128.31.32:9876')
    });

    it('Should have set the password', function () {
      expect(result.myservice.password).toBe('babylonian')
    });

    it('Should have set the username', function () {
      expect(result.myservice.username).toBe('copper king')
    });
  });
});
