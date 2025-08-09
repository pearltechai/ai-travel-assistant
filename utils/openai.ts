import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system';
import { fromByteArray } from 'base64-js';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

function getApiKey(): string {
  const key = (Constants?.expoConfig?.extra as any)?.openaiApiKey || (Constants as any)?.manifest?.extra?.openaiApiKey;
  if (!key) throw new Error('Missing OPENAI_API_KEY');
  return key;
}

export async function chatCompletion(messages: ChatMessage[]): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.7,
    }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI Chat error: ${response.status} ${errText}`);
  }
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('No content');
  return text;
}

export async function ttsToMp3(text: string, voice: 'alloy' | 'nova' = 'nova'): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({ model: 'tts-1', voice, input: text, response_format: 'mp3' }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI TTS error: ${response.status} ${errText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const base64 = fromByteArray(new Uint8Array(arrayBuffer));
  const fileUri = FileSystem.cacheDirectory + `speech-${Date.now()}.mp3`;
  await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
  return fileUri;
}

export async function transcribeAudio(fileUri: string): Promise<string> {
  const fileInfo = await FileSystem.getInfoAsync(fileUri);
  if (!fileInfo.exists) throw new Error('Audio file does not exist');

  const form = new FormData();
  const file: any = {
    uri: fileUri,
    name: 'audio.m4a',
    type: 'audio/m4a',
  };
  form.append('file', file);
  form.append('model', 'whisper-1');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: form as any,
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI STT error: ${response.status} ${errText}`);
  }
  const data = await response.json();
  const text = data?.text?.trim();
  if (!text) throw new Error('No transcript');
  return text;
}


