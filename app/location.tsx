import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Animated } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import {
  chatCompletion,
  ttsToMp3,
  transcribeAudio,
  type ChatMessage,
} from '../utils/openai';

type LocationInfo = { name: string; description: string };

const SYSTEM_PROMPT = `You are a concise travel guide. Always respond in the user's language if possible. Stay on-topic for the given coordinates and location.
For the first response, you must return STRICT JSON only in the following shape and nothing else:
{
  "name": "<short location name>",
  "description": "<1-2 sentence interesting overview>"
}`;

export default function LocationScreen() {
  const router = useRouter();
  const { coords } = useLocalSearchParams<{ coords?: string }>();

  const [title, setTitle] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [chatLoading, setChatLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isTalking, setIsTalking] = useState<boolean>(false);
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: 'system', content: SYSTEM_PROMPT }]);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const firstRunRef = useRef<boolean>(true);
  const loaderOpacity = useRef(new Animated.Value(0.3)).current;

  const stopAndUnloadSound = useCallback(async () => {
    if (soundRef.current) {
      try { await soundRef.current.stopAsync(); } catch {}
      try { await soundRef.current.unloadAsync(); } catch {}
      soundRef.current = null;
    }
  }, []);

  const playMp3 = useCallback(async (uri: string) => {
    await stopAndUnloadSound();
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
  }, [stopAndUnloadSound]);

  const parseStrictJson = (raw: string): LocationInfo | null => {
    try {
      const j = JSON.parse(raw);
      if (j && typeof j.name === 'string' && typeof j.description === 'string') return j as LocationInfo;
    } catch {}
    // Fallback: try fenced blocks
    const match = raw.match(/```(?:json)?\n([\s\S]*?)```/i);
    if (match) {
      try {
        const j = JSON.parse(match[1]);
        if (j && typeof j.name === 'string' && typeof j.description === 'string') return j as LocationInfo;
      } catch {}
    }
    return null;
  };

  const init = useCallback(async () => {
    if (!coords) { setError('Missing coordinates'); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const userMsg: ChatMessage = { role: 'user', content: `Coordinates: ${coords}` };
      const text = await chatCompletion([ { role: 'system', content: SYSTEM_PROMPT }, userMsg ]);
      const info = parseStrictJson(text);
      if (!info) throw new Error('Failed to parse location JSON');
      setTitle(info.name);
      // Seed conversation: first assistant turn is the JSON (store description only for context)
      setMessages([ { role: 'system', content: SYSTEM_PROMPT }, userMsg, { role: 'assistant', content: info.description } ]);
      const mp3 = await ttsToMp3(info.description, 'nova');
      await playMp3(mp3);
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [coords, playMp3]);

  useEffect(() => {
    if (firstRunRef.current) {
      firstRunRef.current = false;
      init();
    }
    return () => {
      stopAndUnloadSound();
      if (recordingRef.current) {
        try { recordingRef.current.stopAndUnloadAsync(); } catch {}
        recordingRef.current = null;
      }
    };
  }, [init, stopAndUnloadSound]);

  const goBack = useCallback(async () => {
    if (isTalking) return; // prevent navigation while recording
    await stopAndUnloadSound();
    router.back();
  }, [isTalking, router, stopAndUnloadSound]);

  const startRecording = useCallback(async () => {
    try {
      setIsTalking(true);
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();
      recordingRef.current = recording;
    } catch (e) {
      setIsTalking(false);
    }
  }, []);

  const stopRecording = useCallback(async () => {
    if (!recordingRef.current) return null;
    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      return uri;
    } catch {
      recordingRef.current = null;
      return null;
    }
  }, []);

  const toggleTalk = useCallback(async () => {
    if (loading || chatLoading) return; // disable during loading
    if (!isTalking) {
      await startRecording();
      return;
    }
    // going from Active -> Inactive
    setIsTalking(false);
    const uri = await stopRecording();
    if (!uri) return;
    try {
      setChatLoading(true);
      const transcript = await transcribeAudio(uri);
      const nextMessages: ChatMessage[] = [ ...messages, { role: 'user', content: transcript } ];
      setMessages(nextMessages);
      const assistant = await chatCompletion(nextMessages);
      const updated: ChatMessage[] = [ ...nextMessages, { role: 'assistant', content: assistant } ];
      setMessages(updated);
      const mp3 = await ttsToMp3(assistant, 'nova');
      await playMp3(mp3);
    } catch (e) {
      // swallow error, UI stays minimal
    } finally {
      setChatLoading(false);
      // cleanup temp file
      try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch {}
    }
  }, [isTalking, loading, chatLoading, messages, playMp3, stopRecording]);

  // Animate loader when chat loading
  useEffect(() => {
    if (chatLoading) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(loaderOpacity, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(loaderOpacity, {
            toValue: 0.3,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      loaderOpacity.setValue(0.3);
    }
  }, [chatLoading, loaderOpacity]);

  // Filter messages for chat display (exclude system messages)
  const chatMessages = useMemo(() => {
    return messages.filter(msg => msg.role !== 'system');
  }, [messages]);

  const renderChatMessage = useCallback((message: ChatMessage, index: number) => {
    const isUser = message.role === 'user';
    return (
      <View key={index} style={[styles.messageContainer, isUser ? styles.userMessageContainer : styles.assistantMessageContainer]}>
        <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.assistantBubble]}>
          <Text style={[styles.messageText, isUser ? styles.userMessageText : styles.assistantMessageText]}>
            {message.content}
          </Text>
        </View>
      </View>
    );
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.header}> 
        <Text style={styles.title}>{title || (loading ? 'Loading…' : error ? 'Error' : 'Location')}</Text>
      </View>

      <View style={styles.controlsRow}>
        <TouchableOpacity style={[styles.controlButton, styles.controlLeft, styles.controlOutline]} onPress={goBack} disabled={isTalking || loading || chatLoading}>
          <Text style={[styles.controlText, styles.controlTextPrimary]}>Go back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.controlButton, styles.controlRight, isTalking ? styles.controlActive : styles.controlOutline]}
          onPress={toggleTalk}
          disabled={loading || chatLoading}
          activeOpacity={0.85}
        >
          <Text style={[styles.controlText, isTalking ? styles.controlTextOnActive : styles.controlTextPrimary]}>
            {isTalking ? 'Stop' : 'Talk'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Loader for chat completion */}
      {chatLoading && (
        <View style={styles.loaderContainer}>
          <Animated.View style={[styles.loader, { opacity: loaderOpacity }]} />
        </View>
      )}

      {/* Chat Messages Container */}
      <View style={styles.chatContainer}>
        <ScrollView 
          style={styles.chatScrollView}
          contentContainerStyle={styles.chatScrollContent}
          showsVerticalScrollIndicator={false}
        >
          {chatMessages.map(renderChatMessage)}
        </ScrollView>
      </View>

      {loading && (
        <View style={styles.loadingWrap}>
          <ActivityIndicator />
        </View>
      )}
      {!!error && !loading && (
        <View style={styles.loadingWrap}><Text style={styles.errorText}>{error}</Text></View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 64,
    paddingHorizontal: 20,
    backgroundColor: '#F4F6F8',
  },
  header: {
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  controlButton: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  controlLeft: {
    marginRight: 6,
  },
  controlRight: {
    marginLeft: 6,
  },
  controlOutline: {
    backgroundColor: '#FFFFFF',
    borderColor: '#CBD5E1',
  },
  controlActive: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  controlText: {
    fontSize: 15,
    fontWeight: '600',
  },
  controlTextPrimary: {
    color: '#1E293B',
  },
  controlTextOnActive: {
    color: '#FFFFFF',
  },
  loadingWrap: {
    marginTop: 18,
    alignItems: 'center',
  },
  errorText: {
    color: '#DC2626',
  },
  loaderContainer: {
    marginTop: 12,
    marginBottom: 8,
    alignItems: 'center',
  },
  loader: {
    width: 40,
    height: 2,
    backgroundColor: '#2563EB',
    borderRadius: 1,
    opacity: 0.7,
  },
  chatContainer: {
    flex: 1,
    marginTop: 16,
    marginBottom: 20,
  },
  chatScrollView: {
    flex: 1,
  },
  chatScrollContent: {
    paddingTop: 8,
    paddingBottom: 16,
  },
  messageContainer: {
    marginVertical: 4,
    paddingHorizontal: 4,
  },
  userMessageContainer: {
    alignItems: 'flex-end',
  },
  assistantMessageContainer: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    maxWidth: '80%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    marginHorizontal: 4,
  },
  userBubble: {
    backgroundColor: '#2563EB',
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 20,
  },
  userMessageText: {
    color: '#FFFFFF',
  },
  assistantMessageText: {
    color: '#1E293B',
  },
});


