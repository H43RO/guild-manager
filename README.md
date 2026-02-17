# 🏰 MapleStory Guild Manager

메이플스토리 길드 관리를 위한 스마트한 대시보드 시스템입니다. Nexon Open API를 활용하여 실시간 길드원 정보 동기화, 수로 점수 관리, 벌점 내역 및 개별 길드 직위 체계 구축 기능을 제공합니다.

## ✨ 주요 기능

- **실시간 대시보드**: 길드원 현황, 전투력 분포 등을 한눈에 확인
- **수로 점수 분석**: 주차별 수로 점수 기록 및 상세 통계 지표 제공
- **길드별 직위 관리**: 각 길드마다 독립적인 직위명, 승급 조건, 혜택 설정 기능
- **통합 벌점 시스템**: 운영 이력과 연계된 투명한 벌점 관리
- **스마트 랭킹**: 월드 내 길드 랭킹 조회 및 내 길드 하이라이팅
- **하이브리드 저장소**: 로컬 환경(JSON 파일)과 웹 호스팅 환경(LocalStorage) 모두 지원

## 🚀 시작하기

### GitHub Pages (추천)
현재 레포지토리의 **Settings > Pages**에서 `main` 브랜치를 활성화하면 즉시 웹 주소로 사용할 수 있습니다.

### 로컬 실행 (Backend 지원)
서버를 통해 `data.json` 파일에 데이터를 직접 저장하고 싶다면 아래 과정을 따르세요.

1.  Node.js를 설치합니다.
2.  프로젝트 폴더에서 서버를 실행합니다:
    ```bash
    node server.js
    ```
3.  브라우저에서 `http://localhost:3000`으로 접속합니다.

## 🛠 기술 스택
- **Frontend**: Vanilla JS, CSS3, HTML5
- **Backend**: Node.js (Simple File-System DB)
- **API**: Nexon Open API (메이플스토리)

---
Developed by [H43RO](https://github.com/H43RO)
