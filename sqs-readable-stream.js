// Treat an Amazon SQS Queue as a Node Stream

/*jslint node: true */
"use strict";
var Readable = require('stream').Readable;
var util = require('util');
var _ = require('underscore');

var SQSReadableStream = module.exports = function SQSReadableStream(options) {
  options = _.defaults(
    options,
    {
      // aws-sdk SQS object
      sqsClient: null,
      // URL of an SQS queue
      queueUrl: null,
      // Retry connectiont to SQS if it fails?
      retryOnErrors: true,
      // Time (ms) to wait on first error (will increase by doubling)
      initialBackoff: 100,
      // Maximum time (ms) to wait on error 
      maxBackoff: 15000,
      // Options to pass to receiveMessage
      receiveMessageOptions: {},
      // Options to pass to the underlying Readable stream
      streamOptions: {},
      // Should we stop when the queue is empty (default is to keep
      // waiting for new items to be added)
      stopOnQueueEmpty: false
    });

  _.defaults(options.streamOptions, {objectMode: true, highWaterMark: 5});
  _.defaults(options.receiveMessageOptions, {
    AttributeNames: [ 'All' ],
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 20
  });

  if (!options.sqsClient || !_.isFunction(options.sqsClient.receiveMessage)) {
    throw new Error("Please pass in a SQS object from the AWS SDK");
  }
  
  Readable.call(this, options.streamOptions);
  this.sqsClient = options.sqsClient;
  this.receiveMessageOptions = options.receiveMessageOptions;
  this.queueUrl = options.queueUrl;
  this.retryOnErrors = options.retryOnErrors;
  this.maxBackoff = options.maxBackoff || 60000;
  this.initialBackoff = options.initialBackoff || 100;
  this.stopOnQueueEmpty = options.stopOnQueueEmpty;
  
  this._readInProgress = false;
  this._retryWait = this.initialBackoff;
};

util.inherits(SQSReadableStream, Readable);

function receive() {
  if (this._readInProgress) return;
  this._readInProgress = true;
  
  var self = this;
  var params = _.defaults({QueueUrl: this.queueUrl}, this.receiveMessageOptions);

  this.sqsClient.receiveMessage(params, function(err, data) {
    if (err) {
      self._readInProgress = false;
      if (self.retryOnErrors) {
        self.emit('retry', err);
        setTimeout(_.bind(receive, self), self._retryWait);
        self._retryWait = self._retryWait * 2;
      } else {
        self.emit('error', err);
        self.push(null);
      }
      return;
    }
    
    self._retryWait = self.initialBackoff;
    
    var readMore = true;
    if (data && data.Messages && data.Messages.length > 0) {
      data.Messages.forEach(function (message) {
        // Add a deleteMessage method to the message to make it easy to delete
        message.deleteMessage = function (callback) {
          self.sqsClient.deleteMessage({
            QueueUrl: self.queueUrl,
            ReceiptHandle: message.ReceiptHandle
          }, callback || function () {});
        };

        // Add a changeMessageVisibility method to the message to make it easy to change the visibility
        message.changeMessageVisibility = function (visibility, callback) {
          if (_.isFunction(visibility)) {
            callback = visibility;
            visibility = 0;
          }

          self.sqsClient.changeMessageVisibility({
            QueueUrl: self.queueUrl,
            ReceiptHandle: message.ReceiptHandle,
            VisibilityTimeout: visibility || 0
          }, callback || function () {});
        };
        
        message.QueueUrl = self.queueUrl;
          
        readMore = readMore && !!self.push(message);
      });
    } else {
      if (self.stopOnQueueEmpty) {
        self.push(null);
        return;
      }
    }
    self._readInProgress = false;
    if (readMore) {
      receive.call(self);
    }
  });
};

SQSReadableStream.prototype._read = function () {
  receive.call(this);
};
