# studio

后端文件 backend/data/ 修改为了 歌名_专辑名/
├── 歌名_专辑名.mp3
├── 歌名_专辑名_beat.json
├── piano/
│   ├── 歌名_专辑名_piano.mp3
│   └── 歌名_专辑名_piano.mid
├── other/
│   ├── 歌名_专辑名_other.mp3
│   └── 歌名_专辑名_other.mid
├── vocals/
│   └── 歌名_专辑名_vocals.mp3
├── bass/
│   └── 歌名_专辑名_bass.mp3
├── drums/
│   └── 歌名_专辑名_drums.mp3
└── guitar/
    └── 歌名_专辑名_guitar.mp3。 歌名_专辑名_beat.json 是这首歌共用的 节拍增强，开始重构代码，移除右侧 MIDI VERSION 相关内容，然后 MIDI INSTRUMENT 修改为  INSTRUMENT 乐器选择，就是 选择什么就是什么乐器和音色，对应到上面的结构，然后 ├── vocals/
│   └── 歌名_专辑名_vocals.mp3
├── bass/
│   └── 歌名_专辑名_bass.mp3
├── drums/
│   └── 歌名_专辑名_drums.mp3
└── guitar/
    └── 歌名_专辑名_guitar.mp3 不需要播放midi，只有对应的分离音频和original音频
