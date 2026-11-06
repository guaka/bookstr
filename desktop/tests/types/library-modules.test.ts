import { SPEECH_MODELS, SpeechModelStore, sourceUrl } from '../../src/speech-model-store';

const store = new SpeechModelStore('/library', {
  models: SPEECH_MODELS,
  downloader: async (_url, _destination, _expectedBytes, onBytes) => onBytes(4, 4),
  randomId: () => 'staging',
});

const model = SPEECH_MODELS[0];
if (model) {
  const file = model.files[0];
  if (file) {
    const url: string = sourceUrl(model, file);
    void url;
  }
}

const installation: Promise<import('../../src/speech-model-store').PublicSpeechModel[]> = store.install(
  'kokoro_en',
  progress => {
    const received: number = progress.receivedBytes;
    const file: string = progress.file;
    void received;
    void file;
  },
);
const status: Promise<import('../../src/speech-model-store').PublicSpeechModel[]> = store.status();
void installation;
void status;

// @ts-expect-error Model identifiers are strings and progress callbacks receive structured progress.
void store.install(42, progress => progress.notAProgressField);
