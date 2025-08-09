import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system';
import { fromByteArray } from 'base64-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

function getOpenAIApiKey(): string {
  const key = (Constants?.expoConfig?.extra as any)?.openaiApiKey || (Constants as any)?.manifest?.extra?.openaiApiKey;
  if (!key) throw new Error('Missing OPENAI_API_KEY');
  return key;
}

function getGeminiApiKey(): string {
  const key = (Constants?.expoConfig?.extra as any)?.geminiApiKey || (Constants as any)?.manifest?.extra?.geminiApiKey;
  if (!key) throw new Error('Missing GEMINI_API_KEY');
  return key;
}

export async function chatCompletion(messages: ChatMessage[]): Promise<string> {
  const genAI = new GoogleGenerativeAI(getGeminiApiKey());
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

  // Convert OpenAI format messages to Gemini format
  const history: any[] = [];
  const parts: any[] = [];
  
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    
    if (message.role === 'system') {
      // Add system message as part of the first user message or as context
      parts.push({ text: `System: ${message.content}` });
    } else if (message.role === 'user') {
      if (i === messages.length - 1) {
        // Last message should be the current prompt
        parts.push({ text: message.content });
      } else {
        // Add to history
        history.push({
          role: 'user',
          parts: [{ text: message.content }]
        });
      }
    } else if (message.role === 'assistant') {
      history.push({
        role: 'model',
        parts: [{ text: message.content }]
      });
    }
  }

  try {
    const chat = model.startChat({ history });
    const result = await chat.sendMessage(parts);
    const response = await result.response;
    const text = response.text();
    
    if (!text) throw new Error('No content from Gemini');
    return text.trim();
  } catch (error: any) {
    throw new Error(`Gemini Chat error: ${error.message}`);
  }
}

export async function ttsToMp3(text: string, voice: 'alloy' | 'nova' = 'nova'): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getOpenAIApiKey()}`,
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
      Authorization: `Bearer ${getOpenAIApiKey()}`,
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


