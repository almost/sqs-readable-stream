var SQSReadableStream = require('./sqs-readable-stream');
var expect = require('expect.js');
var _ = require('underscore');

var messagesFixture = function () {
  return _.times(10, function (i) {
    return {
      Body: "Message #" + i,
      ReceiptHandle: "RECEIPT_" + i
    };
  });
};

var oldNextTick = process.nextTick;


describe('SQSReadableStream', function () {
  var sqsClient,sqsStream, receiveMessageArgs, deleteMessageArgs, nextTickScheduled;

  function runNextTicks () {
    var execute = function (fn) {
        fn();
    };
    while (nextTickScheduled.length) {
      var fns = nextTickScheduled;
      nextTickScheduled = [];
      fns.forEach(execute);
    }
  }

  beforeEach(function () {
    nextTickScheduled = [];
    process.nextTick = function (fn) {
      nextTickScheduled.push(fn);
    };
    
    sqsClient = {
      receiveMessage: function (params, callback) {
        receiveMessageArgs = {params: params, callback: callback};
      },
      deleteMessage: function (params, callback) {
        deleteMessageArgs = {params: params, callback: callback};
      }
    };
    
    receiveMessageArgs = null;
    deleteMessageArgs = null;
    
    sqsStream = new SQSReadableStream({
      queueUrl: "http://aws.example.com/queue",
      sqsClient: sqsClient,
      receiveMessageOptions: {
        testOption: 99
      },
      initialBackoff: 1
    });
  });

  afterEach(function () {
    sqsStream.pause();
  });

  
  describe('Readable', function () {
    it('should not contact SQS when in its initial paused state', function () {
      expect(receiveMessageArgs).not.to.be.ok();
    });
    
    it('should request items from SQS when resumed', function () {
      sqsStream.resume();
      runNextTicks();
      expect(receiveMessageArgs).to.be.ok();
    });

    it('should pass on QueueURL and receiveMessageOptions to receiveMessage call', function () {
      sqsStream.resume();
      runNextTicks();
      expect(receiveMessageArgs.params.QueueUrl).to.be("http://aws.example.com/queue");
      expect(receiveMessageArgs.params.testOption).to.be(99);
    });

    it('should pass returned queue items to the data event', function () {
      var messages = [];
      sqsStream.on('data', function (message) {
        messages.push(message);
      });
      runNextTicks();
      expect(receiveMessageArgs).to.be.ok();
      receiveMessageArgs.callback(null, {
        Messages: messagesFixture()
      });
      expect(_.pluck(messages, 'Body')).to.eql(_.pluck(messagesFixture(), 'Body'));
    });

    it('should request more items once the first lot have been processed', function () {
      sqsStream.resume(); // Force it to start right now (eg not next tick)
      runNextTicks();
      expect(receiveMessageArgs).to.be.ok();
      var callback = receiveMessageArgs.callback;
      receiveMessageArgs = null;
      
      callback(null, {
        Messages: messagesFixture()
      });
      
      runNextTicks();

      // Should have been called again
      expect(receiveMessageArgs).to.be.ok();
    });

    it('should not request any more items if paused', function () {
      sqsStream.resume(); // Force it to start right now (eg not next tick)
      runNextTicks();
      
      expect(receiveMessageArgs).to.be.ok();
      var callback = receiveMessageArgs.callback;
      receiveMessageArgs = null;
      sqsStream.pause();
      runNextTicks();
      
      callback(null, {
        Messages: messagesFixture()
      });
      runNextTicks();

      // Should NOT have been called again
      expect(receiveMessageArgs).not.to.be.ok();
    });

    it('should retry on errors when retryOnErrors option is given', function (done) {
      sqsStream.resume(); // Force it to start right now (eg not next tick)
      runNextTicks();
      
      expect(receiveMessageArgs).to.be.ok();
      var callback = receiveMessageArgs.callback;
      receiveMessageArgs = null;
      
      callback("FAIL");
      runNextTicks();

      // Should NOT have been called again right away
      expect(receiveMessageArgs).not.to.be.ok();
      runNextTicks();

      setTimeout(function () {
        if (receiveMessageArgs) {
          done();
        } else {
          done(new Error("Didn't retry"));
        }
      }, 10);
    });
       
    it('should pass on errors when retryOnErrors option is false', function () {
      var error;

      sqsStream = new SQSReadableStream({
        queueUrl: "http://aws.example.com/queue",
        sqsClient: sqsClient,
        retryOnErrors: false
      });

      sqsStream.on('error', function (_error ) {
        error = _error;
      });
      
      sqsStream.resume(); // Force it to start right now (eg not next tick)
      runNextTicks();
      
      var callback = receiveMessageArgs.callback;
      receiveMessageArgs = null;
      callback("FAIL");
      runNextTicks();

      // Should NOT have been called again right away
      expect(receiveMessageArgs).not.to.be.ok();

      expect(error).to.be("FAIL");
      runNextTicks();

      setTimeout(function () {
        if (!receiveMessageArgs) {
          done();
        } else {
          done(new Error("Retried when it shouldn't have"));
        }
      }, 100);
    });

    it('should stop when queue is empty if stopOnQueueEmpty option is true', function (done) {
      var ended = false;

      sqsStream = new SQSReadableStream({
        queueUrl: "http://aws.example.com/queue",
        sqsClient: sqsClient,
        stopOnQueueEmpty: true
      });
      
      sqsStream.on('end', function () {
        ended = true;
      });
      
      sqsStream.resume(); // Force it to start right now (eg not next tick)
      runNextTicks();
      
      expect(receiveMessageArgs).to.be.ok();
      var callback = receiveMessageArgs.callback;
      receiveMessageArgs = null;
      
      callback(null, {Messages: []});
      runNextTicks();

      // Should NOT have been called again 
      expect(receiveMessageArgs).not.to.be.ok();

      runNextTicks();
      setTimeout(function () {
        if (ended) {
          done();
        } else {
          done(new Error("Didn't get an 'end' event"));
        }
      }, 20);
    });
  });

  describe('message.deleteMessage', function () {
    var messages;
    beforeEach(function () {
      messages = [];
      sqsStream.on('data', function (message) {
        messages.push(message);
      });
      runNextTicks();
      receiveMessageArgs.callback(null, {
        Messages: messagesFixture()
      });
      
      runNextTicks();
    });
    
    it('should call deleteMessage on the SQS client', function () {
      var myCallback = function () {};
      messages[0].deleteMessage(myCallback);
                                
      expect(deleteMessageArgs.params.QueueUrl).to.be("http://aws.example.com/queue");
      expect(deleteMessageArgs.params.ReceiptHandle).to.be(messages[0].ReceiptHandle);
      expect(deleteMessageArgs.callback).to.be(myCallback);
    });

    it('should allow the callback to be ommited', function () {
      messages[0].deleteMessage();
                                
      expect(deleteMessageArgs.params.QueueUrl).to.be("http://aws.example.com/queue");
      expect(deleteMessageArgs.params.ReceiptHandle).to.be(messages[0].ReceiptHandle);
      expect(_.isFunction(deleteMessageArgs.callback)).to.be.ok();
    });
  });
});
