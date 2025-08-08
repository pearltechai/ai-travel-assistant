import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system';
import { Audio } from 'expo-av';
import { fromByteArray } from 'base64-js';

export default function App() {
  const [inputValue, setInputValue] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const soundRef = useRef<Audio.Sound | null>(null);

  const openAIApiKey = useMemo(() => {
    return (Constants?.expoConfig?.extra as any)?.openaiApiKey || (Constants as any)?.manifest?.extra?.openaiApiKey;
  }, []);

  const parseCoordinates = useCallback((text: string): string | null => {
    const trimmed = text.trim();
    const match = trimmed.match(/^\s*(-?\d{1,3}\.\d+|\d{1,3})\s*,\s*(-?\d{1,3}\.\d+|\d{1,3})\s*$/);
    if (!match) return null;
    const lat = Number(match[1]);
    const lon = Number(match[2]);
    if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return `${lat}, ${lon}`;
  }, []);

  const fetchDescription = useCallback(async (coords: string): Promise<string> => {
    const prompt = `Give me a short and interesting description of the location at these coordinates: ${coords}`;
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openAIApiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a concise travel guide. Responses should be 1-2 sentences.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 120,
      }),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI Chat error: ${response.status} ${errText}`);
    }
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('No description returned');
    return text;
  }, [openAIApiKey]);

  const synthesizeSpeech = useCallback(async (text: string): Promise<string> => {
    // Use the TTS API to get MP3 audio and save to a file, return the file URI
    const ttsUrl = 'https://api.openai.com/v1/audio/speech';
    const response = await fetch(ttsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openAIApiKey}`,
      },
      body: JSON.stringify({
        model: 'tts-1',
        voice: 'nova',
        input: text,
        response_format: 'mp3',
      }),
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
  }, [openAIApiKey]);

  const playAudio = useCallback(async (uri: string): Promise<void> => {
    if (soundRef.current) {
      await soundRef.current.stopAsync().catch(() => {});
      await soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
    }
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      staysActiveInBackground: false,
      playsInSilentModeIOS: true,
      interruptionModeIOS: 1,
      shouldDuckAndroid: true,
      interruptionModeAndroid: 1,
      playThroughEarpieceAndroid: false,
    });
    const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
    soundRef.current = sound;
  }, []);

  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return;
    const parsed = parseCoordinates(inputValue);
    if (!parsed || !openAIApiKey) {
      return;
    }
    try {
      setIsSubmitting(true);
      const description = await fetchDescription(parsed);
      const mp3Uri = await synthesizeSpeech(description);
      await playAudio(mp3Uri);
    } catch (err) {
      // Intentionally silent to keep UI minimal
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  }, [fetchDescription, inputValue, isSubmitting, openAIApiKey, parseCoordinates, playAudio, synthesizeSpeech]);

  useEffect(() => {
    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
      }
    };
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.heading}>Enter coordinates</Text>

        <TextInput
          value={inputValue}
          onChangeText={setInputValue}
          placeholder="e.g., 40.7128, -74.0060"
          placeholderTextColor="#9CA3AF"
          keyboardType="numbers-and-punctuation"
          returnKeyType="done"
          textContentType="none"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />

        <TouchableOpacity style={[styles.button, isSubmitting && styles.buttonDisabled]} activeOpacity={0.8} onPress={handleSubmit} disabled={isSubmitting}>
          <Text style={styles.buttonText}>{isSubmitting ? 'Working…' : 'Submit'}</Text>
        </TouchableOpacity>
      </View>

      <StatusBar style="dark" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: '#F4F6F8',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    // subtle shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 8,
  },
  heading: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 12,
    textAlign: 'center',
  },
  input: {
    width: '100%',
    height: 52,
    borderRadius: 12,
    paddingHorizontal: 16,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    color: '#111827',
    fontSize: 16,
    textAlign: 'center',
  },
  button: {
    marginTop: 14,
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563EB',
    // subtle shadow for button
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: Platform.OS === 'android' ? 4 : 0,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
}); 