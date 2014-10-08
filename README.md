SQSReadableStream
=========

Create a Readable Node.JS stream from an Amazon Simple Queue Service
(AWS SQS) queue.

By default it will carry on waiting for items on the queue forever, it
will retry on errors and backpreasure is handled appropriately.


Install
-------

```bash
npm install --save sqs-readable-stream
```

Example
-------

```javascript
var AWS = require('aws-sdk');
var SQSReadableStream = require('sqs-readable-stream');
var sqs = new AWS.SQS({
  apiVersion: '2012-11-05',
  region: 'us-east-1',
  accessKeyId: 'YOUR AMAZON ACCESS KEY',
  
});

var sqsStream = new SQSReadableStream({
    sqsClient: this.sqsClient,
    queueUrl: queueUrl
});

sqsStream.on('data', function (message) {
  console.log('New message:', message.Body);
  message.deleteMessage(function (err) {
    if (err) {
      console.log('Failed to delete message')
    } else (
      console.log('Deleted message');
    }
  });
});

sqsStream.on('error', function (error) {
  console.log('Error receiving messages:', error);
});
```

Messages
--------

The messages passed through the stream are as returned from aws-sdk
with the addition of a `deleteMessage` method which can be used as a
shortcut to delete the message from the queue.

Constructor Options
-------

The following options can be passed into the constructor.

- `sqsClient` (*required*) :: An instance of the SQS class from the
  AWS SDK (or something else that acts like one)
- `queueUrl` (*required*) :: The URL of the SQS Queue to read from
- `receiveMessageOptions` :: Options to pass into the calls to
  receiveMessage. Defaults to:

```javascript
{
  AttributeNames: [ 'All' ],
  MaxNumberOfMessages: 10,
  WaitTimeSeconds: 20
}
```

- `retryOnErrors` (default: true) :: Controls whether it will retry
  after receiving errors from SQS. 
- `initialBackoff` (default: 100) :: Time (ms) to wait on first error
  (will increase by doubling for each consecutive error)
- `maxBackoff` (default: 15000) :: Maximum time (ms) to wait on error 
- `stopOnQueueEmpty` (default: false) :: Controls whether it will stop
  (eg emit and `end` event) when the Queue is empty. The default
  behaviour is to wait for new items forever.

Contributing
------------

Fixed or improved stuff? Great! Send me a pull request [through GitHub](http://github.com/almost/sqs-readbale-stream) or get in touch on Twitter [@almostobsolete][#tom-twitter] or email at tom@almostobsolete.net

[#tom]: http://www.almostobsolete.net
[#tom-twitter]: https://twitter.com/almostobsolete
