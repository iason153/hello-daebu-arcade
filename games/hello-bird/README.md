# 헬로버드 배포용 파일

## 폴더 구조
```
index.html     ← 게임 본체 (33KB, 가벼움)
assets/        ← 실제 이미지·오디오 파일 44+9개 (약 9.3MB)
```

## 배포 방법 (Vercel)

1. 이 폴더 전체를 GitHub 저장소 `iason153/hello-daebu-arcade`의 `games/hello-bird/` 경로에 그대로 업로드
2. Vercel 대시보드 → New Project → 해당 저장소 선택 → Root Directory를 `games/hello-bird`로 지정
3. Framework Preset은 "Other" (빌드 과정 필요 없는 순수 정적 사이트) → Deploy

빌드 명령어나 별도 설정 없이 바로 배포돼요. index.html이 assets 폴더의 실제 파일들을 상대경로로 불러오는 구조라, 두 개를 항상 같은 폴더 안에 함께 두셔야 해요.

## claude.ai 아티팩트 방식과 달라진 점

- 예전: 이미지를 전부 텍스트로 변환해서 파일 하나에 욱여넣음 (12MB, 16MB 넘으면 못 씀)
- 지금: 이미지가 각자 파일로 존재, index.html은 "이 파일을 불러와" 라고 경로만 가리킴
- 앞으로 상점 이미지가 아무리 늘어나도 이 구조에서는 용량 제한이 사실상 없어요
