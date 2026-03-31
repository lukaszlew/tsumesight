# TsumeSight Design Notes

## Engagement Loop Architecture

### Layer 1 — Session Loop (minutes)
Problem → score → immediately show next problem. No library browsing between.
The friction of choosing kills momentum. Rush mode does this naturally — a timer
creates urgency, and problems auto-advance. The score counter ticking up is a
live compulsion loop.

### Layer 2 — Daily Loop (hours)
Daily Challenge creates an appointment. You open the app because "today's 3
problems are waiting." The streak counter adds loss aversion — "I'm on day 23,
I can't break it." The shareable score card adds social validation — you post
your result, friends see it, they try to beat it.

Scarcity is critical: you CAN'T grind the daily. 3 problems, done. This prevents
burnout and makes each attempt feel precious. Rush / time trial modes satisfy
the "I want more" urge without diluting the daily.

### Layer 3 — Weekly Loop (days)
Leagues reset weekly. You're in a group of 20 people. Top 5 promote, bottom 5
demote. This creates:
- Social comparison: "I'm 3rd, but 4th is close"
- Loss aversion: "I'll demote if I don't play"
- Achievable goals: promoting one tier feels doable, not overwhelming
- XP from all modes (daily, rush, time trial) feeds into league ranking

### Layer 4 — Long-term Loop (weeks/months)
- Calendar heatmap fills up — you see your history, gaps bother you
- Achievements unlock — always one more badge close to earning
- Difficulty progression — started doing easy, now doing medium. Visible growth
- Tournament events — monthly or seasonal, creates anticipation

## Psychological Techniques

### Variable Rewards (dopamine from unpredictability)
- Rush mode: you don't know what problem comes next
- Daily challenge: difficulty varies, some days you ace it, some days you don't
- Achievement reveals: "You just unlocked...!" — unexpected badge popup

### Loss Aversion (stronger than gain motivation)
- Streak counter: losing a 30-day streak HURTS
- League demotion: more motivating than promotion
- Time trial lives: losing a life creates tension

### Near-miss Effect (almost winning feels like almost losing)
- Score animation that shows "2/3 groups correct" — so close to perfect
- Rush mode: timer runs out mid-problem — "one more second!"
- League: "You needed 5 more XP to promote"

### Social Proof & Obligation
- Shareable score cards: seeing friends' scores
- Friend streaks: if your friend played today and you didn't...
- League: you're competing, people can see you

### Endowed Progress (starting partway motivates completion)
- Show "3/10 achievements in this category" — feels like you're already invested
- Calendar: first few days filled in — don't break the pattern
- Directory progress: "7/15 problems mastered"

### Appointment Mechanics (FOMO)
- Daily challenge refreshes at midnight
- Weekly league resets on Monday
- Monthly tournament window

## Game Modes

### Daily Challenge
- 3 problems per day: easy, medium, hard
- Fixed canonical problem library
- Same 3 problems for all users (seeded by date)
- Score: accuracy descending, time ascending (speed is tiebreaker only)
- Archive available for past days
- Strictly 3 problems, can't redo — scarcity makes the score meaningful

### Rush Mode (from goproblems.com)
- 3-minute / 5-minute / untimed variants
- Solve as many problems as possible
- Score = total correct groups across all problems
- Leaderboards: daily, weekly, monthly

### Time Trial (from goproblems.com)
- Limited lives (e.g., 4 lives)
- 1 minute per problem
- Score = problems solved + remaining lives + time

### Tournaments (from goproblems.com)
- Live "Solving Royale" competitions
- Increasing difficulty rounds, elimination

## Retention Features

### Streak Counter
- Days-in-a-row counter shown prominently ("Day 47")
- Missing a day resets it
- Key insight from Wordle: scarcity (1/day) + shared experience + streak = viral

### Leagues (from Duolingo)
- Weekly groups of ~20 users
- Ranked by total XP (problems solved x accuracy)
- 9 tiers (Bronze → Diamond), promote/demote each week
- Creates recurring low-stakes competition

### Achievements
- 100+ unlockable badges
- Categories: streak milestones, solving totals, skill-based, mode-specific
- Examples: "10 perfect scores", "30-day streak", "Rush: 50+ groups",
  "Complete Chapter 3", "Month of daily challenges"
- Endowed progress: show "3/10 in this category"

### Calendar Heatmap
- GitHub-style grid showing daily activity
- Green squares, intensity = score
- "Don't break the chain" retention mechanic

### Shareable Score Card (from Wordle)
- After daily challenge, generate minimal emoji result:
  "TsumeSight Daily #47: 🟩🟩🟥 2/3 ⏱ 23s"
- Copy to clipboard button
- Green/red per group, spoiler-free
- Social proof + competition without needing a backend

### Score Animation
- When submitting, animate the score counting up
- Numbers flying into place, Vampire Survivors-style satisfying sounds

### Friend Streak (from Duolingo)
- Maintain streaks with up to 5 friends
- Social accountability

### XP System (from Duolingo)
- Everything earns XP, feeds into league ranking
- Unified currency across all modes

### Notifications (from Duolingo)
- Personalized reminders to maintain streak

### Session Summary
- After finishing N problems, show:
  "Today: 5 problems, 87% average, 3 perfect scores". Brief, no-click.

### Difficulty Badges
- After solving, show a badge for the problem's difficulty

### Spaced Repetition
- Problems you got wrong come back sooner, Anki-style intervals

## Difficulty Classification

Factors for easy/medium/hard:
- Sequence length
- Whether moves jump around the board
- Whether there are captures
- Whether there are under-the-stones plays
- More subjective factors (reading depth, unusual shapes)
- For now: manual tagging in SGF metadata, revisit auto-classification later

## Multi-user Backend

- Backend: Supabase (Postgres + auth + real-time)
- Auth: both anonymous (device-based ID) and login (Google/GitHub)
- Leaderboard: today's scores + historical
- Free tier: 500MB Postgres, 50k MAU, built-in auth

## Deferred

- Personal bests banner: hard to make meaningful when easy problems trivially get 100%
- Elo-like rating: unclear how to calibrate against problem difficulty without data
- Puzzle Streak (Lichess-style): difficulty variance between problems makes this unfair
- Puzzle Racer (Lichess-style): real-time multiplayer doesn't map well to longer exercises
