import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

const translations = {
  en: {
    'app.title': 'MuVisual | Piano Roll',
    'language.current': 'EN',
    'language.switch': 'Switch to Chinese',
    'import.label': 'Import MIDI',
    'library.home': 'MuVisual home',
    'library.tagline': 'MAKE MUSIC VISIBLE',
    'library.search': 'Search tracks or albums',
    'library.clearSearch': 'Clear search',
    'library.kicker': 'VISUAL COLLECTION',
    'library.title': 'Library',
    'library.description': 'Choose a track and enter the visual performance space.',
    'library.arrangements': 'ARRANGEMENTS',
    'library.connectionError': 'Could not connect to the library. Make sure the backend service is running.',
    'library.openError': 'Could not open "{title}". Please try again later.',
    'library.loading': 'Loading library',
    'library.noResults': 'No results for "{query}"',
    'library.openTrack': 'Open {title}',
    'library.midiReady': 'MIDI READY',
    'library.pianoAndMidi': 'PIANO + MIDI',
    'library.archive': 'MU VISUAL ARCHIVE',
    'library.trackCount': '{count} TRACKS · LOCAL COLLECTION',
    'studio.back': 'Back to library',
    'studio.tagline': 'PIANO ROLL STUDIO',
    'studio.demoArrangement': 'Demo arrangement',
    'studio.timbre': 'MIDI instrument',
    'studio.loading': 'Loading',
    'studio.ready': 'Ready',
    'studio.loadError': 'Load failed',
    'studio.liveVisualizer': 'LIVE VISUALIZER',
    'studio.numberedNotation': 'MIDI NUMBERED NOTATION',
    'studio.viewSettings': 'Visualization and settings',
    'studio.pianoRollView': 'Piano roll view',
    'studio.scoreView': 'MIDI numbered notation view',
    'studio.openSettings': 'Open settings panel',
    'studio.closeSettings': 'Close settings panel',
    'studio.footerEngine': 'SMPLR AUDIO ENGINE · @TONEJS/MIDI PARSER',
    'studio.footerKeys': '88 KEYS · A0 - C8',
    'playback.control': 'PLAYBACK CONTROL',
    'playback.progress': 'Playback progress',
    'playback.pause': 'Pause',
    'playback.play': 'Play',
    'playback.reset': 'Reset',
    'playback.playing': 'Playing',
    'playback.ready': 'Ready to play',
    'playback.summary': '{bpm} BPM · {count} notes',
    'playback.keySignature': 'KEY SIGNATURE',
    'playback.noteLabels': 'NOTE LABELS',
    'playback.noteLabelFormat': 'Piano roll note label format',
    'playback.tempo': 'TEMPO',
    'playback.increaseTempo': 'Increase tempo by 1 BPM',
    'playback.decreaseTempo': 'Decrease tempo by 1 BPM',
    'playback.backgroundDelay': 'BACKGROUND DELAY',
    'playback.increaseDelay': 'Increase background delay by 10 milliseconds',
    'playback.decreaseDelay': 'Decrease background delay by 10 milliseconds',
    'playback.masterVolume': 'MASTER VOLUME',
    'playback.audioSource': 'AUDIO SOURCE',
    'playback.midiInstrument': 'MIDI INSTRUMENT',
    'playback.piano': 'PIANO',
    'playback.string': 'STRING',
    'playback.originalAudio': 'ORIGINAL',
    'playback.mute': 'MUTE AUDIO',
    'playback.unmute': 'UNMUTE AUDIO',
    'playback.midiVersion': 'MIDI VERSION',
    'playback.original': 'ORIGINAL',
    'playback.quantized': 'QUANTIZED',
    'playback.leftHand': 'LEFT HAND',
    'playback.rightHand': 'RIGHT HAND',
    'score.title': 'MIDI NUMBERED SCORE',
    'score.meta': '16TH QUANTIZE · C4 VOICE SPLIT',
    'score.high': 'HIGH',
    'score.low': 'LOW',
    'pianoRoll.scroll': 'Scroll piano visualizer playback position',
  },
  zh: {
    'app.title': 'MuVisual | 钢琴卷帘可视化',
    'language.current': '中',
    'language.switch': '切换至英文',
    'import.label': '导入 MIDI',
    'library.home': 'MuVisual 首页',
    'library.tagline': '让音乐清晰可见',
    'library.search': '搜索曲目或专辑',
    'library.clearSearch': '清除搜索',
    'library.kicker': '可视化曲集',
    'library.title': '曲库',
    'library.description': '选择一首曲目，进入可视化演奏空间。',
    'library.arrangements': '首编曲',
    'library.connectionError': '无法连接曲库，请确认后端服务已启动。',
    'library.openError': '无法打开《{title}》，请稍后重试。',
    'library.loading': '正在读取曲库',
    'library.noResults': '没有找到“{query}”',
    'library.openTrack': '打开 {title}',
    'library.midiReady': 'MIDI 已就绪',
    'library.pianoAndMidi': '钢琴音频 + MIDI',
    'library.archive': 'MU VISUAL 曲库',
    'library.trackCount': '本地曲库 · 共 {count} 首',
    'studio.back': '返回曲库',
    'studio.tagline': '钢琴卷帘工作室',
    'studio.demoArrangement': '示例编曲',
    'studio.timbre': 'MIDI 音色',
    'studio.loading': '加载中',
    'studio.ready': '已就绪',
    'studio.loadError': '加载失败',
    'studio.liveVisualizer': '实时可视化',
    'studio.numberedNotation': 'MIDI 简谱',
    'studio.viewSettings': '可视化视图与设置',
    'studio.pianoRollView': '钢琴卷帘视图',
    'studio.scoreView': 'MIDI 简谱视图',
    'studio.openSettings': '打开设置面板',
    'studio.closeSettings': '关闭设置面板',
    'studio.footerEngine': 'SMPLR 音频引擎 · @TONEJS/MIDI 解析器',
    'studio.footerKeys': '88 键 · A0 - C8',
    'playback.control': '播放控制',
    'playback.progress': '播放进度',
    'playback.pause': '暂停',
    'playback.play': '播放',
    'playback.reset': '重新开始',
    'playback.playing': '正在播放',
    'playback.ready': '可以播放',
    'playback.summary': '{bpm} BPM · {count} 个音符',
    'playback.keySignature': '调号',
    'playback.noteLabels': '音符标记',
    'playback.noteLabelFormat': '钢琴卷帘音符标记格式',
    'playback.tempo': '速度',
    'playback.increaseTempo': '速度增加 1 BPM',
    'playback.decreaseTempo': '速度降低 1 BPM',
    'playback.backgroundDelay': '画面延迟',
    'playback.increaseDelay': '画面延迟增加 10 毫秒',
    'playback.decreaseDelay': '画面延迟减少 10 毫秒',
    'playback.masterVolume': '主音量',
    'playback.audioSource': '音频来源',
    'playback.midiInstrument': 'MIDI 音源',
    'playback.piano': '钢琴',
    'playback.string': '弦乐',
    'playback.originalAudio': '原曲',
    'playback.mute': '静音',
    'playback.unmute': '取消静音',
    'playback.midiVersion': 'MIDI 版本',
    'playback.original': '原始',
    'playback.quantized': '量化',
    'playback.leftHand': '左手',
    'playback.rightHand': '右手',
    'score.title': 'MIDI 数字简谱',
    'score.meta': '十六分音符量化 · 以 C4 分声部',
    'score.high': '高音',
    'score.low': '低音',
    'pianoRoll.scroll': '滚动钢琴可视化播放位置',
  },
} as const;

export type Language = keyof typeof translations;
export type TranslationKey = keyof typeof translations.en;
type TranslationValues = Record<string, string | number>;
type I18nContextValue = {
  language: Language;
  toggleLanguage: () => void;
  t: (key: TranslationKey, values?: TranslationValues) => string;
};

const STORAGE_KEY = 'muvisual-language';
const I18nContext = createContext<I18nContextValue | null>(null);

function getInitialLanguage(): Language {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'zh' || saved === 'en') return saved;
  return /^zh(?:-|$)/i.test(navigator.language) ? 'zh' : 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(getInitialLanguage);

  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    document.title = translations[language]['app.title'];
  }, [language]);

  const value = useMemo<I18nContextValue>(() => ({
    language,
    toggleLanguage: () => setLanguage(current => {
      const next = current === 'zh' ? 'en' : 'zh';
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    }),
    t: (key, values) => {
      let message: string = translations[language][key];
      if (!values) return message;
      Object.entries(values).forEach(([name, replacement]) => {
        message = message.split(`{${name}}`).join(String(replacement));
      });
      return message;
    },
  }), [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside I18nProvider');
  return context;
}
