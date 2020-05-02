import { Service, State } from 'iw-base/lib/registry';
import { IwDeepstreamClient } from 'iw-base/modules/deepstream-client';
import { getLogger } from 'iw-base/lib/logging';
import MemoryStream from 'memory-stream';
import request = require('request');
import { IncomingMessage } from 'http';
import wav from 'wav';
// Speaker typedefs appear to be broken
// tslint:disable-next-line: no-var-requires
const Speaker = require('speaker');

const log = getLogger('TTSService');

export class TTSService extends Service {

  constructor(private ds: IwDeepstreamClient) {
    super('TTSService');
  }

  async start() {
    this.ds.subscribeEvent('voice-output/request-speak', (text: string) => this.speakText(text));
    this.setState(State.OK);
  }

  async stop(): Promise<void> {
    this.setState(State.INACTIVE);
  }

  private speakText(text: string) {
    this.setState(State.BUSY, 'converting text-to-speech ...');

    const memoryStream = new MemoryStream();
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
      this.setState(State.BUSY, 'speaking ...');

      const reader = new wav.Reader();
      // the "format" event gets emitted at the end of the WAVE header
      reader.on('format', (format) => {

        // the WAVE header is stripped from the output of the reader
        const speaker = new Speaker(format);
        reader.pipe(speaker);
        speaker.on('close', () => this.setState(State.OK, 'Ready for text-to-speech playback'));
      });
      reader.end(memoryStream.toBuffer());
    });
  }
}
