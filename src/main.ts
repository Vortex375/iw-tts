import { IwDeepstreamClient } from 'iw-base/modules/deepstream-client';
import { UdpDiscovery } from 'iw-base/modules/udp-discovery';
import { TTSService } from './modules/tts/tts';

const client = new IwDeepstreamClient();
const discovery = new UdpDiscovery(client);
const tts = new TTSService(client);
discovery.start({ requestPort: 6031, broadcastPort: 6034 });

client.on('connected', () => {
  tts.start();

  /* create a parrot */
  client.subscribeEvent('voice-input/text', (text) => client.emitEvent('voice-output/request-speak', text))
});
