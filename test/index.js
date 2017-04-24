var consul = require('consul')({promisify: true});
var config = require('../index');
var nock = require('nock');

var defaultHeaders = {
    'x-consul-index': '666',
    'x-consul-lastcontact': '10',
    'x-consul-knownleader': 'true',
    'x-consul-translate-addresses': 'true'
  };

var cfg = {
  value: config.value({optional: true}),
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

  it('should be set on the config', function () {
    config.build(cfg).then(function (result) {
      expect(result.valueWithDefault).toBe(123);
    });
  })

})

describe('When a defaulted value is set by environment variable', function () {

  beforeEach(function() {
    process.env.DB_CREDENTIALS_USERNAME = 'rootato'
  })

  it('should use the environment value', function () {
    config.build(cfg).then(function (result) {
      expect(result.db.credentials.username).toBe('rootato');
    });
  })

  afterEach(function () { delete process.env.DB_CREDENTIALS_USERNAME });
})

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
    }).catch(function (e) { console.log("FEERERE", e) });
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
