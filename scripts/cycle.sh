#!/usr/bin/env bash
# 수집 한 바퀴: (처음 한 번) data 브랜치에서 파일 복원 → 혼잡도·행사 수집 → 패턴·적중률 → 브리핑 → 소음 센서 → data 브랜치 게시.
# GitHub Actions의 수집 작업이 매시 이 스크립트를 부른다(.github/workflows/collect.yml).
# 필요한 환경변수: SEOUL_KEY, GITHUB_TOKEN, GITHUB_REPOSITORY. 선택: GEMINI_KEY, FORCE, FORCE_BRIEFING, SDOT_MAX_DAYS.
set -uo pipefail

FILES="snapshot.json history.json pattern.json metrics.json briefing.json noise_state.json noise.json"
MARK=".data-restored"

restore() {
  # data 브랜치가 아예 없는 첫 실행과, 있는데 못 읽은 경우를 구분한다.
  # 있는데 못 읽으면 실패시켜, 빈 이력으로 새로 시작해 강제 푸시로 덮어쓰는 일을 막는다.
  local rc=0
  git ls-remote --exit-code --heads origin data >/dev/null || rc=$?
  if [ "$rc" -eq 2 ]; then
    echo "data branch does not exist yet (first run)"
  elif [ "$rc" -ne 0 ]; then
    echo "cannot reach origin (ls-remote exit $rc)"
    return 1
  else
    git fetch -q origin data:data || return 1
    for f in $FILES; do
      git show "data:$f" > "$f" 2>/dev/null || rm -f "$f"
    done
    test -s snapshot.json || return 1
    test -s history.json || return 1
  fi
  touch "$MARK"
}

publish() {
  # data 브랜치는 항상 커밋 1개만 둔다(누적 파일이 커밋마다 쌓여 저장소가 커지는 것을 막는다)
  local pub=/tmp/calm-publish
  rm -rf "$pub" && mkdir -p "$pub"
  for f in $FILES; do
    if [ -s "$f" ]; then cp "$f" "$pub/"; fi
  done
  test -s "$pub/snapshot.json" || { echo "nothing to publish"; return 1; }
  test -s "$pub/history.json" || { echo "history.json missing; not publishing"; return 1; }
  (
    cd "$pub" || exit 1
    git init -q
    git config user.name "calm-map-bot"
    git config user.email "bot@users.noreply.github.com"
    git add .
    git commit -q -m "snapshot $(date -u +%Y-%m-%dT%H:%MZ)"
    git push -q --force "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" HEAD:refs/heads/data
  )
}

if [ ! -f "$MARK" ]; then
  restore || { echo "restore failed"; exit 1; }
fi

changed=false
export GITHUB_OUTPUT=/tmp/cycle-output.txt
: > "$GITHUB_OUTPUT"
if python3 scripts/collect_seoul.py snapshot.json history.json; then
  grep -q '^changed=true' "$GITHUB_OUTPUT" && changed=true
else
  echo "collect failed"
fi
unset FORCE  # 강제 수집은 첫 바퀴에만 적용한다

if [ "$changed" = true ]; then
  python3 scripts/derive_stats.py history.json pattern.json metrics.json || echo "derive failed"
  python3 scripts/gen_briefing.py snapshot.json briefing.json || echo "briefing failed"
  unset FORCE_BRIEFING
fi
python3 scripts/collect_sdot.py noise_state.json noise.json || echo "sdot failed"
grep -q '^sdot_changed=true' "$GITHUB_OUTPUT" && changed=true

if [ "$changed" = true ]; then
  publish && echo "published $(date -u +%H:%MZ)" || echo "publish failed"
else
  echo "no change this cycle"
fi
