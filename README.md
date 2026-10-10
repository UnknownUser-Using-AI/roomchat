# roomchat

닉네임만으로 참여하는 공개 실시간 채팅방입니다. Supabase는 방·메시지 데이터와 이미지 파일을 저장하고, GitHub Pages는 정적 웹 파일을 호스팅합니다.

## 기능

- 로그인 없이 닉네임을 정해 참여합니다. 닉네임 설정은 브라우저 메모리에만 있고 새로고침 후에는 다시 입력합니다. 전송된 메시지에는 당시 닉네임이 표시됩니다.
- 공개 방을 만들거나 다른 방으로 이동합니다. 현재 방 이름과 실시간 Presence 참여자 수가 표시됩니다.
- Supabase Realtime으로 새 메시지를 받고 최근 100개 메시지를 표시합니다.
- PC에서는 메시지 입력창에 복사한 이미지를 붙여넣고, 모바일에서는 파일 선택 버튼으로 이미지를 고릅니다. 최대 8MB의 JPEG/PNG/WebP/GIF/AVIF를 지원합니다.
- 알림 버튼을 눌러 브라우저 권한을 허용하면 새 메시지를 Notification API로 알립니다. 알림은 이 탭이 열려 있고 Supabase Realtime 연결이 살아 있을 때 전달됩니다.

## Supabase

저장소 루트의 `migration.sql`을 Supabase SQL Editor에서 적용하면 `rooms`, `messages` 테이블, 공개 익명 읽기/추가 정책, Realtime publication, `chat-images` 공개 버킷과 익명 업로드 정책이 구성됩니다. 브라우저 연결값은 `config.js`에 있습니다. publishable key는 브라우저 공개 키이며 비밀이 아닙니다. `service_role` 키는 절대로 프론트엔드에 넣지 마세요.

**공개 서비스 안내:** 모든 방, 메시지, 공유 이미지가 공개됩니다. 로그인 없는 익명 이용자는 누구나 방과 메시지/이미지를 올릴 수 있으므로 민감한 정보를 보내지 마세요. 이 기본 배포는 게시 빈도 제한이나 운영자 삭제 기능을 제공하지 않습니다.

## GitHub Pages

1. 모든 웹 파일을 저장소 루트에 둡니다 (`index.html` 포함).
2. GitHub **Settings → Pages → Build and deployment → Deploy from a branch**를 선택합니다.
3. Branch를 `main`, folder를 `/(root)`로 지정하고 저장합니다. 빌드 명령은 필요 없습니다.
4. 생성된 `https://<계정>.github.io/<저장소>/`에서 접속합니다.

## 모바일 알림 한계

Notification API 권한은 사용자의 버튼 클릭으로 요청합니다. 사이트가 열려 있고 실시간 채널이 연결되어야 메시지 알림을 받을 수 있습니다. 브라우저를 완전히 닫았을 때의 푸시 알림은 이 프로젝트 범위가 아니며 별도의 Web Push 서버/구독 설정이 필요합니다. iPhone/iPad에서는 iOS·브라우저 지원 조건에 따라 홈 화면에 추가한 웹앱에서만 알림이 제공될 수 있습니다.
