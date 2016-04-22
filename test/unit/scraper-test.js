var should = require('should');
var sinon = require('sinon');
require('sinon-as-promised');
var nock = require('nock');
var proxyquire = require('proxyquire');
var fs = require('fs-extra');
var path = require('path');
var _ = require('lodash');
var Scraper = require('../../lib/scraper');
var Resource = require('../../lib/resource');

var testDirname = __dirname + '/.scraper-test';
var urls = [ 'http://example.com' ];

describe('Scraper', function () {

	beforeEach(function() {
		nock.cleanAll();
		nock.disableNetConnect();
	});

	afterEach(function() {
		nock.cleanAll();
		nock.enableNetConnect();
		fs.removeSync(testDirname);
	});

	describe('#validate', function () {
		it('should return resolved promise if everything is ok', function (done) {
			var s = new Scraper({
				urls: urls,
				directory: testDirname
			});

			s.validate().then(function() {
				should(true).eql(true);
				done();
			}).catch(function() {
				done(new Error('Promise should not be rejected'));
			});
		});

		it('should return rejected promise if directory exists', function (done) {
			fs.mkdirpSync(testDirname);

			var s = new Scraper({
				urls: urls,
				directory: testDirname
			});

			s.validate().then(function() {
				done(new Error('Promise should not be resolved'));
			}).catch(function(err) {
				err.should.be.an.instanceOf(Error);
				done();
			});
		});


		it('should return rejected promise if no directory was provided', function (done) {
			var s = new Scraper({
				urls: urls
			});

			s.validate().then(function() {
				done(new Error('Promise should not be resolved'));
			}).catch(function(err) {
				err.should.be.an.instanceOf(Error);
				done();
			});
		});
	});

	describe('#prepare', function() {
		it('should create directory', function(done) {
			var s = new Scraper({
				urls: urls,
				directory: testDirname
			});

			s.prepare().then(function() {
				var exists = fs.existsSync(testDirname);
				exists.should.be.eql(true);
				done();
			}).catch(done);
		});

		it('should create an Array of urls if string was passed', function(done) {
			var s = new Scraper({
				urls: 'http://not-array-url.com',
				directory: testDirname
			});

			s.prepare().then(function() {
				s.options.urls.should.be.an.instanceOf(Array).and.have.length(1);
				done();
			}).catch(done);
		});

		it('should create Resource object for each url', function(done) {
			var s = new Scraper({
				urls: [
					'http://first-url.com',
					{ url: 'http://second-url.com' },
					{ url: 'http://third-url.com' }
				],
				directory: testDirname
			});

			s.prepare().then(function() {
				s.originalResources.should.be.an.instanceOf(Array).and.have.length(3);
				s.originalResources[0].should.be.an.instanceOf(Resource);
				s.originalResources[1].should.be.an.instanceOf(Resource);
				s.originalResources[2].should.be.an.instanceOf(Resource);
				_.filter(s.originalResources, { url: 'http://first-url.com' }).should.have.length(1);
				_.filter(s.originalResources, { url: 'http://second-url.com' }).should.have.length(1);
				_.filter(s.originalResources, { url: 'http://third-url.com' }).should.have.length(1);
				done();
			}).catch(done);
		});

		it('should use urls filename', function(done) {
			var s = new Scraper({
				urls: { url: 'http://first-url.com', filename: 'first.html' },
				directory: testDirname
			});

			s.prepare().then(function() {
				s.originalResources[0].getFilename().should.be.eql('first.html');
				done();
			}).catch(done);
		});

		it('should use default filename if no url filename was provided', function(done) {
			var s = new Scraper({
				urls: { url: 'http://first-url.com' },
				defaultFilename: 'default.html',
				directory: testDirname
			});

			s.prepare().then(function() {
				s.originalResources[0].getFilename().should.be.eql('default.html');
				done();
			}).catch(done);
		});

		it('should extend sources if recursive flag is set', function(done) {
			var s = new Scraper({
				urls: { url: 'http://first-url.com' },
				directory: testDirname,
				sources: [
					{ selector: 'img', attr: 'src' }
				],
				recursive: true
			});

			s.prepare().then(function() {
				s.options.sources.should.have.length(2);
				s.options.sources.should.containEql({ selector: 'img', attr: 'src' });
				s.options.sources.should.containEql({ selector: 'a', attr: 'href' });
				done();
			}).catch(done);
		});

		it('should bind request object to makeRequest method', function(done) {
			var requestStub = sinon.stub().resolves();
			var Scraper = proxyquire('../../lib/scraper', {
				'./request': requestStub
			});

			var reqOpts = {
				headers: {
					'User-Agent': 'Mozilla/5.0 (Linux; Android 4.2.1;'
				}
			};

			var s = new Scraper({
				urls: { url: 'http://first-url.com' },
				directory: testDirname
			});
			s.options.request = reqOpts;

			s.prepare().then(function() {
				s.makeRequest('http://example.com').then(function() {
					requestStub.calledOnce.should.be.eql(true);
					requestStub.calledWith(reqOpts).should.be.eql(true);
					done();
				}).catch(done);
			}).catch(done);
		});
	});

	describe('#load', function() {
		it('should call loadResource for each url', function(done) {
			nock('http://first-url.com').get('/').reply(200, 'OK');
			nock('http://second-url.com').get('/').reply(200, 'OK');

			var s = new Scraper({
				urls: [
					'http://first-url.com',
					'http://second-url.com'
				],
				directory: testDirname
			});

			var loadResourceSpy = sinon.spy(s, 'loadResource');
			s.prepare().bind(s).then(s.load).then(function() {
				loadResourceSpy.calledTwice.should.be.eql(true);
				done();
			}).catch(done);
		});

		it('should return array of objects with url, filename and assets', function(done) {
			nock('http://first-url.com').get('/').reply(200, 'OK');
			nock('http://second-url.com').get('/').reply(500);

			var s = new Scraper({
				urls: [
					'http://first-url.com',
					'http://second-url.com'
				],
				directory: testDirname
			});

			s.prepare().bind(s).then(s.load).then(function(res) {
				res.should.be.instanceOf(Array);
				res.should.have.length(2);
				res[0].should.have.properties(['url', 'filename', 'assets']);
				res[1].should.have.properties(['url', 'filename', 'assets']);
				done();
			}).catch(done);
		});
	});

	describe('#errorCleanup', function() {
		it('should throw error', function(done) {
			var s = new Scraper({
				urls: 'http://example.com',
				directory: testDirname
			});

			s.prepare().then(function() {
				return s.errorCleanup(new Error('everything was broken!'));
			}).then(function() {
				done(new Error('Promise should not be resolved'));
			}).catch(function(err) {
				err.should.be.instanceOf(Error);
				err.message.should.be.eql('everything was broken!');
				done();
			});
		});

		it('should remove directory if error occurs and something was loaded', function(done) {
			var s = new Scraper({
				urls: 'http://example.com',
				directory: testDirname
			});

			s.prepare().then(function() {
				s.addLoadedResource(new Resource('http://some-resource.com'));
				fs.existsSync(testDirname).should.be.eql(true);
				return s.errorCleanup();
			}).then(function() {
				done(new Error('Promise should not be resolved'));
			}).catch(function() {
				fs.existsSync(testDirname).should.be.eql(false);
				done();
			});
		});

		it('should not remove directory if error occurs and nothing was loaded', function(done) {
			var s = new Scraper({
				urls: 'http://example.com',
				directory: testDirname
			});

			s.prepare().then(function() {
				fs.existsSync(testDirname).should.be.eql(true);
				return s.errorCleanup();
			}).then(function() {
				done(new Error('Promise should not be resolved'));
			}).catch(function() {
				fs.existsSync(testDirname).should.be.eql(true);
				done();
			});
		});
	});

	describe('#getLoadedResource', function() {
		it('should find nothing if no resource with same url was loaded',function(done) {
			var s = new Scraper({
				urls: 'http://example.com',
				directory: testDirname
			});

			s.prepare().then(function() {
				var a = new Resource('http://first-resource.com');
				var loaded = s.getLoadedResource(a);
				should(loaded).be.empty();
				done();
			}).catch(done);
		});

		it('should find loaded resource with same url', function(done) {
			var s = new Scraper({
				urls: 'http://example.com',
				directory: testDirname
			});

			s.prepare().then(function() {
				var a = new Resource('http://first-resource.com');
				s.addLoadedResource(a);

				var b = new Resource('http://first-resource.com');
				var c = new Resource('http://first-resource.com/');
				var d = new Resource('http://first-resource.com?');
				should(s.getLoadedResource(b)).be.equal(a);
				should(s.getLoadedResource(c)).be.equal(a);
				should(s.getLoadedResource(d)).be.equal(a);

				done();
			}).catch(done);
		});
	});

	describe('#loadResource', function() {
		it('should load resource', function(done) {
			nock('http://example.com').get('/a.png').reply(200, 'OK');

			var s = new Scraper({
				urls: 'http://example.com',
				directory: testDirname
			});

			s.prepare().then(function() {
				var r = new Resource('http://example.com/a.png');
				s.loadResource(r).then(function(lr) {
					lr.should.be.eql(r);
					lr.getUrl().should.be.eql('http://example.com/a.png');
					lr.getFilename().should.be.not.empty();
					lr.getText().should.be.eql('OK');

					var text = fs.readFileSync(path.join(testDirname, lr.getFilename())).toString();
					text.should.be.eql(lr.getText());
					done();
				});
			}).catch(done);
		});

		it('should not load the same resource twice (should return already loaded)', function(done) {
			nock('http://example.com').get('/a.png').reply(200, 'OK');

			var s = new Scraper({
				urls: 'http://example.com',
				directory: testDirname
			});

			s.prepare().then(function() {
				var r1 = new Resource('http://example.com/a.png');
				var r2 = new Resource('http://example.com/a.png');
				s.loadResource(r1).then(function() {
					s.loadResource(r2).then(function(lr) {
						lr.should.be.equal(r1);
						lr.should.not.be.equal(r2);
					});
					done();
				});
			}).catch(done);
		});

		it('should load the resource if the urlFilter returns true', function(done){
			nock('http://example.com').get('/a.png').reply(200, 'OK');

			var s = new Scraper({
				urls: ['http://example.com', 'http://google.com'],
				directory: testDirname,
				urlFilter: function(url){
					return url.indexOf('http://example.com') !== -1;
				}
			});

			s.prepare().then(function() {
				var r = new Resource('http://example.com/a.png');
				s.loadResource(r).then(function(lr) {
					lr.should.be.eql(r);
					lr.getUrl().should.be.eql('http://example.com/a.png');
					lr.getFilename().should.be.not.empty();
					lr.getText().should.be.eql('OK');

					var text = fs.readFileSync(path.join(testDirname, lr.getFilename())).toString();
					text.should.be.eql(lr.getText());
					done();
				});
			}).catch(done);
		});

		it('should not return an promise resolved with null if the urlFilter returns false', function(done){
			var s = new Scraper({
				urls: ['http://example.com', 'http://google.com'],
				directory: testDirname,
				urlFilter: function(url){
					return url.indexOf('http://example.com') !== -1;
				}
			});

			s.prepare().then(function() {
				var r = new Resource('http://google.com/a.png');
				s.loadResource(r).then(function(lr) {
					should.equal(lr, null);
					done();
				});
			}).catch(done);
		});

		it('should load the resource if the urlFilter returns true', function(done){
			nock('http://example.com').get('/a.png').reply(200, 'OK');

			var s = new Scraper({
				urls: ['http://example.com', 'http://google.com'],
				directory: testDirname,
				urlFilter: function(url){
					return url.indexOf('http://example.com') !== -1;
				}
			});

			s.prepare().then(function() {
				var r = new Resource('http://example.com/a.png');
				s.loadResource(r).then(function(lr) {
					lr.should.be.eql(r);
					lr.getUrl().should.be.eql('http://example.com/a.png');
					lr.getFilename().should.be.not.empty();
					lr.getText().should.be.eql('OK');

					var text = fs.readFileSync(path.join(testDirname, lr.getFilename())).toString();
					text.should.be.eql(lr.getText());
					done();
				});
			}).catch(done);
		});

		it('should return an promise resolved with null if the urlFilter returns false', function(done){
			var s = new Scraper({
				urls: ['http://google.com'],
				directory: testDirname,
				urlFilter: function(url){
					return url.indexOf('http://example.com') !== -1;
				}
			});

			s.prepare().then(function() {
				var r = new Resource('http://google.com/a.png');
				s.loadResource(r).then(function(lr) {
					should.equal(lr, null);
					done();
				});
			}).catch(done);
		});
	});

	describe('#getResourceHandler', function() {
		var Scraper;
		var noopStub;
		var cssLoadStub;
		var htmlLoadStub;

		beforeEach(function() {
			noopStub = sinon.stub().resolves();
			cssLoadStub = sinon.stub().resolves();
			htmlLoadStub = sinon.stub().resolves();

			Scraper = proxyquire('../../lib/scraper', {
				'lodash': {
					'noop': noopStub
				},
				'./file-handlers/html': htmlLoadStub,
				'./file-handlers/css': cssLoadStub
			});
		});

		it('should return noop if resource has depth > max', function(done) {
			var s = new Scraper({
				urls: 'http://example.com',
				directory: testDirname,
				maxDepth: 2
			});

			s.prepare().then(function() {
				var r = new Resource('http://example.com/');
				sinon.stub(r, 'getType').returns('html');
				sinon.stub(r, 'getDepth').returns(10);

				s.getResourceHandler(r).call(s, r).then(function() {
					noopStub.called.should.be.eql(true);
					cssLoadStub.called.should.be.eql(false);
					htmlLoadStub.called.should.be.eql(false);

					done();
				});
			}).catch(done);
		});

		it('should return css loader if file has css type', function(done) {
			var s = new Scraper({
				urls: 'http://example.com',
				directory: testDirname,
				maxDepth: 2
			});

			s.prepare().then(function() {
				var r = new Resource('http://example.com/');
				sinon.stub(r, 'getType').returns('css');
				sinon.stub(r, 'getDepth').returns(1);

				s.getResourceHandler(r).call(s, r).then(function() {
					noopStub.called.should.be.eql(false);
					cssLoadStub.called.should.be.eql(true);
					htmlLoadStub.called.should.be.eql(false);

					done();
				});
			}).catch(done);
		});

		it('should return html & css loader if file has html type', function(done) {
			var s = new Scraper({
				urls: 'http://example.com',
				directory: testDirname,
				maxDepth: 2
			});

			s.prepare().then(function() {
				var r = new Resource('http://example.com/');
				sinon.stub(r, 'getType').returns('html');
				sinon.stub(r, 'getDepth').returns(1);

				s.getResourceHandler(r).call(s, r).then(function() {
					noopStub.called.should.be.eql(false);
					cssLoadStub.called.should.be.eql(true);
					htmlLoadStub.called.should.be.eql(true);

					done();
				});
			}).catch(done);
		});
	});

	describe('#scrape', function() {
		it('should call methods in sequence', function(done) {
			nock('http://example.com').get('/').reply(200, 'OK');

			var s = new Scraper({
				urls: 'http://example.com',
				directory: testDirname
			});

			var validateSpy = sinon.spy(s, 'validate');
			var prepareSpy = sinon.spy(s, 'prepare');
			var loadSpy = sinon.spy(s, 'load');

			s.scrape().then(function() {
				validateSpy.calledOnce.should.be.eql(true);
				prepareSpy.calledOnce.should.be.eql(true);
				prepareSpy.calledAfter(validateSpy).should.be.eql(true);
				loadSpy.calledOnce.should.be.eql(true);
				loadSpy.calledAfter(prepareSpy).should.be.eql(true);
				done();
			}).catch(done);
		});

		it('should call errorCleanup on error', function(done) {
			nock('http://example.com').get('/').reply(200, 'OK');

			var s = new Scraper({
				urls: 'http://example.com',
				directory: testDirname
			});

			var loadStub = sinon.stub(s, 'load');
			loadStub.throws('Error');

			var errorCleanupSpy = sinon.spy(s, 'errorCleanup');

			s.scrape().then(function() {
				done(new Error('Promise should not be resolved'));
			}).catch(function() {
				errorCleanupSpy.calledOnce.should.be.eql(true);
				done();
			});
		});
	});
});