import { Service, State } from 'iw-base/lib/registry';
import { IwDeepstreamClient } from 'iw-base/modules/deepstream-client';
import { getLogger } from 'iw-base/lib/logging';
import PulseAudio from 'pulseaudio2';
import MemoryStream from 'memory-stream';
import request = require('request');
import { Transform } from 'stream';
import fs = require('fs');
import { IncomingMessage } from 'http';

const log = getLogger('TTSService');

const SAMPLE_RATE= 22050;

const EMPTY_CHUNK = Buffer.alloc(65536);

export class TTSService extends Service {

  private paContext = new PulseAudio();

  private stream: any;

  private recordingTimer: any;

  constructor(private ds: IwDeepstreamClient) {
    super('TTSService');
  }

  start(): Promise<void> {
    return new Promise(resolve => {
      this.setState(State.BUSY, 'Connecting to PulseAudio ...')
      this.paContext = new PulseAudio();
      this.paContext.on('connection', () => {
        this.setState(State.OK, 'Ready for text-to-speech playback');
        resolve();
      })
      this.paContext.on('error', (err) => {
        log.error({ err }, 'PulseAudio failed');
        this.setState(State.ERROR, 'PulseAudio failed');
      })
    })
    .then(() => {
      this.ds.subscribeEvent('voice-output/request-speak', (text: string) => this.speakText(text));
    });

  }

  async stop(): Promise<void> {
    this.paContext.end();
    this.paContext = undefined;
    this.setState(State.INACTIVE);
  }

  private speakText(text: string) {
    this.setState(State.BUSY, 'converting text-to-speech ...');

    const memoryStream = new MemoryStream();
    const now = Date.now();
    let requestFailed = false;
    request(`http://localhost:5002/api/tts?text=${encodeURIComponent(text)}`)
      .on('response', (response: IncomingMessage) => {
        if (response.statusCode !== 200) {
          log.error({ statusCode: response.statusCode, statusMessage: response.statusMessage }, 'TTS service request failed');
          this.setState(State.ERROR, 'TTS service unavailable');
          requestFailed = true;
        }
      })
      .on('error', (err) => {
        log.error({ err }, 'TTS service request failed');
        this.setState(State.ERROR, 'TTS service unavailable');
        requestFailed = true;
      })
      .pipe(memoryStream);
    memoryStream.on('finish', () => {
      if (requestFailed) {
        return;
      }
      const processingTime = Date.now() - now;
      this.setState(State.BUSY, 'speaking ...');

      const playbackStream = this.paContext.createPlaybackStream({
        format: 'S16LE',
        rate: SAMPLE_RATE,
        channels: 1
      });
      playbackStream.on('finish', () => {
        this.setState(State.OK, 'Ready for text-to-speech playback')
      });

      const buffer = memoryStream.toBuffer();
      /* TTS produces RIFF WAVE files which have a 44-byte header that must be stripped. */
      const trimmedBuffer = Buffer.from(buffer.buffer, 44, buffer.length - 44);
      playbackStream.write(trimmedBuffer);
      /* writing empty chunk is required to actually flush the data -.- */
      playbackStream.write(EMPTY_CHUNK);

      /* Also, the pulseaudio library _disconnects_ the playback stream
       * immediately after the final chunk has been pushed, regardless
       * of whether playback has already finished.
       *
       * Therefore we delay ending the stream until we are sure that all
       * samples have been played back. */
      const bufferLengthMs = Math.ceil(trimmedBuffer.length / 2 / SAMPLE_RATE * 1000);
      setTimeout(() => playbackStream.end(), bufferLengthMs);
      log.debug(`processing time: ${processingTime}ms; speak time: ${bufferLengthMs}ms; ratio: ${processingTime / bufferLengthMs}`);
    });
  }
}

// /**
//  * TTS produces RIFF WAVE files which have a 44-byte header
//  * that must be stripped.
//  *
//  * Also, the pulseaudio library _disconnects_ the playback stream
//  * immediately after the final chunk has been pushed, regardless
//  * of whether playback has already finished.
//  *
//  * Therefore we delay ending the stream until we are sure that all
//  * samples have been played back.
//  */
// class StripFirst44BytesAndDelayEndTransform extends Transform {
//   private remainingTrim = 44;
//   private stopTime: number = undefined;

//   _transform(chunk, encoding, callback) {
//     console.log('chunk', chunk.length);
//     if (this.stopTime === undefined) {
//       this.stopTime = Date.now();
//     }
//     let offset = 0;
//     if (this.remainingTrim > 0) {
//       offset = Math.min(this.remainingTrim, chunk.length);
//       this.remainingTrim -= offset;
//     }
//     console.log('trimming', offset);
//     console.log('peek', Buffer.from(chunk.buffer, offset, 40).toString('hex'))
//     this.push(Buffer.from(chunk.buffer, offset, chunk.length - offset));
//     /* calculate how many samples are left to be played,
//      * so we know approximately when to terminated the stream */
//     this.stopTime += (chunk.length - offset) / SAMPLE_RATE * 1000;

//     callback();
//   }

//   _flush(callback) {
//     this.push(EMPTY_CHUNK);
//     /* end the stream only after we know that all samples have played */
//     const now = Date.now();
//     if (now < this.stopTime) {
//       setTimeout(callback, Math.ceil(this.stopTime - now));
//     } else {
//       callback();
//     }
//   }
// }
