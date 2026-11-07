# Research: basketball game stat apps

How existing basketball stat apps handle live entry and post-game correction, what the
standard UX is, and what that means for [`docs/games-plan.md`](../games-plan.md).

Researched 2026-11-07. App Store data (versions, ratings, reviews) was pulled that day
from Apple's public lookup and review feeds. Vendor features change often; dates are
given wherever a claim could go stale.

**Limits of this survey.** Reddit blocks this research agent, so no r/basketballcoach or
r/Basketball threads are quoted; user pain comes from App Store reviews instead. The
GameChanger and Genius Sports (FIBA LiveStats) help centers block automated readers or
need a login. GameChanger's basketball article is cited from a dated printout a league
posted (captured 2025-03-17), and LiveStats details come from search-indexed help
articles. Both are marked where used. I didn't watch any videos.

## Summary

- **Stat-first is more common than player-first among the big apps.** GameChanger and
  Hoopsalytics tap the stat first, then the player. iScore is player-first. Easy Stats
  advertises "2 fast touches", and one of its users asks for the player-first order
  that Courtside plans. Either order works in two taps. No source shows either one
  winning on speed.
- **Every serious app chains a follow-up after a shot.** After a make the app asks who
  assisted; after a miss it asks who rebounded (GameChanger, iScore, Basketball Stats
  Assistant, FIBA LiveStats). The plan has no follow-up prompts.
- **Everyone keeps an editable play-by-play log.** GameChanger, FIBA LiveStats,
  Hoopsalytics and Breakthrough Stats all let you tap a past play to change it. The
  plan's event log matches this standard.
- **Post-game correction is still weak in the market, and demand is rising.** In
  September 2026 GameChanger announced post-game play-by-play editing (fall 2026) and
  box-score editing (winter 2026) "without reactivating the game". Reviews of older
  apps complain that fixing one early mistake means undoing everything after it, or
  that totals can't be fixed from the box score.
- **Losing data mid-game is the most damaging complaint.** It comes up again and again
  for Basketball Simple Stat Tracker, and also for iScore and Breakthrough. Courtside's
  offline-first, persist-every-tap design is a real advantage here.
- **Forced tracking of subs and the clock is the next most common complaint.** Users of
  Easy Stats, iScore, Breakthrough and MaxStats say it makes live entry impossible to
  keep up with. The plan's choice to skip lineups and keep the clock optional is
  backed by the evidence.
- **Opponent stats are team-level by default in coach-focused apps.** Easy Stats only
  offers team-level, and GameChanger offers a "Team Only" mode. A minority of users ask
  for opponent player fouls. Even under team-level tracking, though, both apps record
  the opponent's free throws and rebounds, which the plan's `Them` row leaves out.
- **No consumer app merges two simultaneous scorers.** GameChanger has one scorer at a
  time with an online handoff. MaxStats keeps each scorer's version separate "for
  comparison". The NBA splits the work by role (two callers, two inputters). Easy Stats
  users ask to "split the stat duty and sync post game".
- **Film-linked stats are the premium tier.** Hudl Assist, Hoopsalytics, TurboStats and
  NBA stat review all tie each stat to video. The plan's `video_at` field leaves room for
  this cheaply.
- **TeamSnap and MaxPreps aren't live scorers.** TeamSnap takes post-game totals entered
  in a browser. MaxPreps imports from partner apps, including its own iPad app MaxStats.

## Per-app comparison

| App (checked) | Entry order | Taps for a simple play | Shot location | Assist / rebound chaining | Undo and edit during the game | Post-game correction | Film link | Opponent | Multiple scorers | Offline |
|---|---|---|---|---|---|---|---|---|---|---|
| **GameChanger** (iOS v2026.43, Nov 2026) | Stat first, then "attribute each selection to a player"; can leave it unassigned | 2 (stat, player) + prompt | Not documented for basketball | Automatic: assist after a make, rebound after a miss; free throws in one sheet | Undo the last play; tap any play in the play-by-play | Today: resume scoring to edit. Fall 2026: edit the play-by-play without reopening. Winter 2026: edit box-score totals | Stream and score on one device turns events into clips (Mar 2025) | Choose "Team Only" or "Player Assignment"; can toggle mid-game | One scorer at a time; handoff needs internet; warning about overwriting | Can score offline after an online sign-in; can't resume a previously scored game offline |
| **Hudl Assist** | n/a: Hudl analysts tag film after the game | n/a | Yes (zone shot chart) | n/a | n/a | Coach edits tags; "edits automatically update" reports; unknown jerseys go through an "Identify Unknown Athletes" workflow | Every data point links to video | Full opponent breakdown (Game and Scout tier) | n/a | n/a (upload) |
| **iScore Basketball** (v3.07, Jan 2026) | Player first, then action | 2–3; "Shot" or a double-tap skips location | Optional: tap the court | Prompts for the assister (offense only) and rebounder (anyone); cancel a mistaken shot | Cancel a shot; double-tap the score or clock to fix it; no general undo described | Play-by-play shown after the game; "Adjust Mode" adds or subtracts totals | No | Full roster, or a single "Team" player | Not documented; export or import between devices | Implied: scorecast "Synchronize" after a bad connection; export after each game |
| **Easy Stats for Basketball** (v18.0, May 2026; 11,395 ratings) | Stat first (a user asks for player first) | "2 fast touches" | Yes (shot charts) | Not documented | Editable game log | Edit the log; users ask to insert a play between others | No (users stat from film by hand) | Team-level only | No; users ask for it; paid cloud sync between your own devices | Works without internet (user review) |
| **Basketball Stats Assistant** (v1.50, Oct 2026) | Action dragged onto a player, or tap | 1 drag + continuation | Yes; editable after the game | "Continuation dialogs" after a made or missed shot, foul, steal or turnover | Drop a red cross on a player to fix | Shot positions editable after the game | No | Unclear | Not documented | Not documented |
| **Basketball Simple Stat Tracker** (v8.0, Nov 2026) | One player per screen (team mode added in v8) | 1 | Yes (heat maps) | No | Unclear | Unclear | Can attach photos or videos to a game | n/a | Live viewers only | Local; many data-loss reviews |
| **Breakthrough Stats** (Mar 2025) | Not documented | "Minimal touches" | Optional | Not documented | "Edit/undo statistics live or after the game"; play-by-play log | Edit via play-by-play only (2013 review) | No | One team or both | Not documented | Local; users ask for cloud |
| **MaxPreps / MaxStats** (MaxStats v4.1.8, Aug 2025) | Not documented | Not documented | Yes | NFHS rules engine "to make data entry faster" | "Real-time editing" | Admin previews before posting to MaxPreps | Attach photos or clips to any event | Full: "for both your team and your opponent" | **Several scorers per game; results "available for comparison"** | Needs internet to load rosters (review); upload broken in the 2025–26 season (reviews) |
| **TeamSnap** | n/a: post-game per-player totals in a web form | n/a | No | n/a | n/a | Edit saved totals | No | No | Admins only | No |
| **Hoopsalytics** (film-based, for reference) | Stat first, then player; hotkeys | 2 | Yes | Auto-categorizes transitions afterward | Click an event in the timeline to change it | Second pass over the film | Every tag linked to a clip | Yes | Not documented | n/a |
| **FIBA LiveStats v7** (pro baseline) | Mark the shot on the court, then shot type and shooter | Several, with predictive workflows | Yes (required) | "Predictive workflows" chain assists, rebounds and foul → free throws | Edit or open any action from the Action Log during play; inconsistent entries are flagged | FIBA Organizer stats edit menu after the game | Not on the product page | Full | Separate in-venue feed; not a merge | Windows desktop app |
| **NBA scoring** (pro baseline) | Callers speak, inputters type | n/a | Yes | n/a | Most changes made in real time with video; league auditors watch live | League reviews every game; corrections can come days later | 12-angle video network | Full | **4 people per game, split by role** | n/a |

### Notes per app

**GameChanger.** GameChanger is the market leader: 918,751 iOS ratings across sports, and
scoring is free for staff. In the basketball article (as printed 2025-03-17), the
opponent row sits at the top of the screen, and "the buttons below your team's name are
for adding stats to your team. You will be asked to attribute each selection to a player
on your team, and can also leave stats unassigned. You will be able to edit any specific
play by tapping it from within the Play by Play section." Follow-ups: "After a shot is
made, the app will automatically ask the user who (if anybody) made the assist … After a
shot is missed, the app will automatically ask the user who got the rebound." A free
throw sheet takes the number of shots, and a missed last free throw falls into the
rebound flow ([Logical stat flows, 2025-08-14](https://gc.com/post/logical-stat-flows)).
Opponent mode is "Team Only" or "Player Assignment", switchable mid-game
([2025-12-08](https://gc.com/post/opponent-scorekeeping-for-basketball)). The fall 2026
roadmap adds simple, advanced, and stream-and-score tiers. It also adds "Postgame
Play-by-Play Editing … without reopening it as a live game" (fall 2026) and "Postgame Box
Score Editing … without editing individual plays or reactivating the game" (winter 2026)
([2026-09-30](https://gc.com/post/basketball-feature-updates-fall-2026)). Offline and
handoff (help center, via search index): you must have signed in online. You "cannot
Resume Scoring while offline on an event that has been previously scored". "An internet
connection is required to transfer scoring to another user." If the event still shows
"Score Game", the second scorer should wait, or the first scorer's unsynced data may be
overwritten. GameChanger also has voice scorekeeping for basketball (date not confirmed).
I found too few basketball-specific GameChanger complaints in the most recent 400 iOS
reviews to rank (most are about baseball or streaming).

**Hudl Assist.** Hudl Assist is a service, not an entry tool. "Professional analysts break
down your film" ([product page](https://www.hudl.com/products/assist/basketball)), and
reports let you click "every data point" to go "directly to video". The FAQ says
"making edits will automatically update any connected data on your Reports page". It
also says that any tags you add while Hudl is tagging "will be removed once you receive
your full breakdown". Pricing depends on sport and level; Game and Game-and-Scout tiers
([FAQ](https://www.hudl.com/en_gb/products/assist/faq)). A Hudl-hosted support index says
analysts tag only the jersey number for players missing from the roster, and coaches must
then resolve them one tag at a time. Hudl Sideline is football-only
([App Store](https://apps.apple.com/us/app/id988525789)). No first-party evidence of a
Hudl live basketball entry app turned up.

**iScore Basketball.** The [training page](https://iscoresports.com/basketball/training.php)
documents the flow: player first, optional tap on the court for location, then prompts
for the assister ("the defense is disabled") and the rebounder. Team fouls reset "to 0
after each period", and fouls appear on the player buttons. To track only the opponent's
score, you create one opponent player named "Team". Reviews are old (most date from
2010–2018) but consistent: "too slow, clunky and limiting to keep up with the speed of a
basketball game" (2013); "if I make a mistake on something, I don't know how to go back
and correct it without having to undo everything I've done since that mistake" (2012);
"I can not put in rebounds without doing stats for the other team as well" (2010).

**Easy Stats for Basketball.** Easy Stats is the most-rated basketball-only app (4.74 from
11,395 ratings). The listing says: "focusing on your team's players. The opponent's stats
are tracked as a team" and "2 fast touches to record any stat"
([App Store](https://apps.apple.com/us/app/id561687907)). Its reviews are the richest
source of evidence for this survey (quoted under pain points). Several users say they
enter stats from film after the game ("I record the games and then afterwards as I'm
editing the game film, I do the stats", 2025-04). Several also ask to split the work
between two people.

**Basketball Stats Assistant.** Its "continuation dialogs … appear on the screen after any
field goal is missed or scored, fouls are committed or drawn, steals or turnovers". You
"fix any mistakes quickly by dropping the red cross icon on the player", and shot
positions stay editable after the game
([App Store](https://apps.apple.com/us/app/id1513397355)). It has only 22 US reviews.
Recent ones say: "No instructions if you make a mistake" (2025-12) and "so complicated"
(2026-10).

**StatKeeper.** I found no basketball app by this name on the US App Store, only
"StatKeeper Baseball", so I skipped it. Basketball Simple Stat Tracker and Breakthrough
Stats are covered as the comparable standalone apps.

**MaxPreps / MaxStats.** The MaxPreps app itself only lets coaches "manage the roster,
schedule, and statistics" ([App Store](https://apps.apple.com/us/app/id980665604)). Stats
come in from GameChanger sync, iScore files, Hoopsalytics exports, or MaxStats
(MaxPreps support pages, via search index). The MaxStats listing is the only
first-party source I found that describes several scorers at one game: "Results from
multiple scorekeepers at the same game are available for comparison"
([App Store](https://apps.apple.com/us/app/id923893903)).

**TeamSnap.** "This can only be done by a team administrator … on the web or mobile
browser, not the mobile apps." You enter per-player totals for each game. "Games do not
show up in the Statistics screen until after the game time"
([help, updated 2026-03-09](https://helpme.teamsnap.com/article/678-enter-player-stats)).
TeamSnap is not a live tracker.

**FIBA LiveStats.** This is the official stats tool for FIBA competitions, a free Windows
desktop app from Genius Sports
([FIBA](https://about.fiba.basketball/en/services/data-and-video-solutions/fiba-live-stats)).
The v7 help articles are now behind a login. From their search-indexed text: you mark a
shot on the court graphic, which sets its value, and then pick the shot type. Recent
actions can be edited live from the Action Log; the editable fields for a made shot are
time, location, team, outcome, shooter, shot type and assist. Inconsistent entries are
"flagged" in the action list. Corrections after the game happen in FIBA Organizer.

**NBA.** Each game has "two stat callers and two stat inputters" from the home team's
staff, with a league stat auditor. "The majority of the changes are made in real time."
Disputed calls go to a post-game discussion
([Action Network, 2022-02-02](https://www.actionnetwork.com/nba/nba-downplays-role-stat-keeping-accuracy-props-go-mainstream-system-constructed-catch-everything)).
Stat corrections can appear up to 7 days after a game
([ESPN support](https://support.espn.com/hc/en-us/articles/360056679592-Stat-corrections)).

## Standard UX patterns

These are what nearly every app does, with the evidence for each:

1. **Two taps per play, in either order.** GameChanger, Hoopsalytics and Easy Stats are
   stat-first; iScore is player-first; Basketball Stats Assistant drags an action onto a
   player.
2. **Automatic follow-ups after shots:** an assist after a make, a rebound after a miss,
   each skippable (GameChanger, iScore, Basketball Stats Assistant, FIBA LiveStats).
3. **A free throw sequence as one unit:** pick the number of shots, then mark each, and a
   missed last shot leads to the rebound prompt (GameChanger, iScore).
4. **Undo the last play, plus tap-to-edit any play in the log** (GameChanger, FIBA,
   Hoopsalytics, Breakthrough, Easy Stats).
5. **A "Team" target for player-less stats:** team rebounds, team turnovers and
   unassigned plays (GameChanger lets you leave stats unassigned; iScore and Easy Stats
   users ask for team rebounds).
6. **Fouls shown on the player buttons, and team fouls that reset by period** (iScore;
   requested in Easy Stats reviews).
7. **The opponent tracked at team level by default in coach-focused apps,** with a
   per-player option in heavier tools (Easy Stats, GameChanger, iScore, MaxStats, FIBA).
8. **Shot location is optional in consumer apps and required in pro tools**
   (iScore, Breakthrough; FIBA requires it).
9. **One scorer per game.** Multi-person setups split work by role (NBA) or compare
   separate versions (MaxStats). None merge two people's live entry.
10. **Film linking comes after the game, as a separate pass or service** (Hudl Assist,
    Hoopsalytics, TurboStats).

## Recurring pain points, ranked by how often they appear

Counts are the low-star or feature-request reviews I read that clearly raise each theme,
drawn from about 750 US App Store reviews across seven apps. Treat the ranking as
indicative, not statistical.

1. **Data loss and crashes mid-game (about 15).** Basketball Simple Stat Tracker:
   "If you close it to take a photo or video, you'll lose everything" (2025-06); "I
   clicked on the checkered flag to finalize it and the app crashed and I lost
   everything" (2023-12); "Game stats not saving if screen times out" (2023-12). iScore:
   "Has lost data, stats, and even teams several times" (2011). Breakthrough: "crashed in
   the 3rd quarter. Most data was lost" (2013). Easy Stats: "During an edit lost
   everything after the edit" (2019).
2. **Can't keep up with a fast game (about 12).** Causes are too many inputs, too many
   screens, or forced bookkeeping. iScore: "Too slow, clunky" (2013), "too complicated in
   order for it to be practical … to use it live" (2010). Breakthrough: "very difficult to
   keep up in a game situation. Trying to keep track of the clock, substitutions, shots"
   (2023). Easy Stats: "almost impossible to keep up with everything" (2025-12).
3. **Correction is hard or undocumented (about 10).** iScore: has to "undo everything
   I've done since that mistake" (2012). Breakthrough: "After charting the game from film,
   you realize player A had 2 offensive boards. You can't simply edit the final report"
   (2013). Easy Stats: "add a stat log in between other stats" (2023), "Can you edit team
   score, fouls, player's points, etc. after multiple possessions, if so how?" (2022).
   Basketball Stats Assistant: "No instructions if you make a mistake" (2025). Simple
   Stat Tracker: "hard to figure out how to make changes if something is entered
   incorrectly" (2023). GameChanger's 2026 roadmap targets this gap directly.
4. **Forced substitution or clock tracking (about 8).** Easy Stats: "if it didn't force
   you to keep track of subs" (2025-05), "Turn off substitution feature" (2025-08). iScore:
   "option to turn off time" (2010), "cumbersome sub feature. I've missed plenty of
   action" (2012). MaxStats: the clock "starts itself automatically even when you want it
   stopped" (2023).
5. **Sync and multi-device failures (about 8).** Easy Stats: "it will NOT synch across
   devices" (2020), "can't get the synch between devices to work" (2026-01), "won't sync"
   (2025-12). MaxStats: "Won't sync with Maxpreps" (2025-11), "Worthless without WiFi"
   (2024). Breakthrough: "Wish this was cloud enabled" (2023).
6. **Wanting a second scorer (about 5).** Easy Stats: "Make it eligible to split the stat
   duty and sync the data post game" (2026-01); "If two people could use the app
   simultaneously you could split the load" (2025-12); "more than one statistician …
   primary and secondary" (2022). MaxStats: "real time sharing" (2021).
7. **Opponent detail, which cuts both ways (about 8).** Users want *more*: Easy Stats,
   "I like to know which players on my opponents team are in foul trouble" (2023), and
   "do this for both teams" (2025, plus about 4 similar). Other users want *less*: iScore,
   "I just want to track 'my' team" (2011), "makes u record too many stats on both sides"
   (2010).
8. **Missing team-foul, bonus and timeout tracking (about 5).** Easy Stats: "reset the
   team fouls at the half … Hard to keep track of bonus status" (2023), "time out section
   … possession arrow" (2026-05), "display team and players fouls on the main screen"
   (2019).
9. **Readability at a glance (about 4).** Easy Stats: "the buttons are really nice and
   big but the text is tiny" (2022), and made and missed shots look alike to a
   color-blind user (2026-01). Simple Stat Tracker: options "so small they are not
   readable" (2023-12).

Paywalls, ads and account recovery also come up often, but they don't apply to Courtside.

## Recommendations for `docs/games-plan.md`

### Adopt (the plan already does this; the evidence backs it)

- **Model, "Events are the source of truth."** Every serious tool keeps an editable
  play-by-play log (GameChanger, FIBA LiveStats, Hoopsalytics, Breakthrough). Computing
  totals from events also avoids the Breakthrough-style complaint where reports drift
  from the log.
- **Model, nullable `player_id` on `us`.** GameChanger lets you "leave stats unassigned"
  and assign them later. This is the standard escape hatch for a play the scorer missed.
- **Model, team-only opponent.** This is the default in coach-focused apps (Easy Stats,
  GameChanger "Team Only"), and complaints run both ways (pain point 7). Keep individual
  opponent players out of scope.
- **Out of scope, lineups, minutes and the clock.** Forced sub and clock tracking is
  pain point 4. An optional `clock` filled in from film beats a running clock.
- **Live screen, foul counts on player buttons.** iScore does this, and Easy Stats users
  ask for it.
- **Work item 2, offline-first, plus the screen staying awake.** Data loss is the top
  complaint (pain point 1), and "Game stats not saving if screen times out" is a direct
  quote. Make sure every tap is durable in Dexie before the UI confirms it (inference:
  the plan implies this, but doesn't say it).
- **Model, `video_at` stored now.** Film-linked stats are what separates premium tools
  (Hudl Assist, Hoopsalytics), and the field costs almost nothing now.

### Change

- **Live screen: add skippable follow-up prompts after shots.** After a miss (ours or
  theirs), show a one-row "Rebound: [players] [Team] [Them] [skip]". After a make, show
  "Assist: [players] [none]". All of GameChanger, iScore, Basketball Stats Assistant and
  FIBA LiveStats do this. It turns a rebound from two taps into one, and nudges the
  scorer toward complete data. The next player tap should dismiss the prompt, so it
  never blocks entry (inference).
- **Live screen, `Them` row: add "FT ✗" and "DREB".** GameChanger's team-level opponent
  tracking still covers "rebounds, turnovers, free throws, and missed shots" (help
  center, via search index). Without opponent free throw misses, their FT% can't be
  computed. Without their defensive rebounds, the rebound margin is wrong: every one of
  our misses they rebound vanishes. Both stats already exist in the `stat` list, so only
  the buttons are missing.
- **Model, "Order", plus Review screen, "Add play": give inserted plays a position.**
  Live events usually have no clock, so they sort by `recorded_at`. A play added from
  film without a clock then lands at the end of its period, not where it happened. Easy
  Stats users ask to "add a stat log in between other stats", and iScore users complain
  about having to undo everything after a mistake. Two options: require a clock on plays
  added in review, or add a fractional `seq` field that the review screen sets when you
  "insert after this play" (inference: either works with per-field last-write-wins).
- **Review screen: add a box-score entry point to corrections.** Tapping a cell (say,
  Riley's OREB) should list just those events, with add and remove. Events stay the
  source of truth; the box score becomes a way in. GameChanger is shipping "Postgame Box
  Score Editing … without editing individual plays" (winter 2026), and a high school
  coach charting from film complained in 2013 that "You can't simply edit the final
  report".
- **Live screen, undo: show the last 3–5 plays as tappable rows,** not just one "Last"
  line. FIBA edits recent actions straight from the action log during play, and
  GameChanger edits any play from the play-by-play mid-game. Keep the one-tap Undo, but
  make it say what it removed (inference from the "no instructions if you make a mistake"
  complaints).
- **Game stats logic: team fouls per period and the bonus.** The plan already counts team
  fouls in the current period. Add a bonus indicator to the header. Users ask for this
  (pain point 8), and iScore resets team fouls each period. NFHS rules as of 2023–24
  reset team fouls each quarter, with two shots from the fifth foul. That's from memory,
  so check it against the current NFHS rule book before building.
- **Open question: answer it as "rarely, and by role, not as equals."** No consumer app
  merges two simultaneous scorers. GameChanger forbids it and warns about overwrites;
  MaxStats keeps separate versions for comparison; the NBA splits callers and inputters.
  The plan's event model already supports two phones splitting the work. Suggest a role
  split in the UI copy, for example one phone for shots and the score, the other for
  rebounds, assists and turnovers (inference). Then rank undo and speed above the
  two-scorer work.
- **Live screen, `Them: miss`: name it honestly.** Recording `fg2_missed` makes the
  opponent's 2-point and 3-point split wrong until someone fixes it from film. That's
  fine if the box score labels opponent misses as "FG missed" without a 2/3 split. No
  source covers this; it's my inference.

### Drop or defer

- **Work item 7, "live entry on both phones" as a Playwright scenario.** Defer it. The
  engine tests in item 2 already cover two devices adding offline and merging. No
  surveyed consumer product supports this mode, and the evidence ranks data durability
  and speed far above it. Keep the offline-then-online and film-correction scenarios,
  which match pain points 1 and 3.
- **Shot locations, still out of scope.** Optional in every consumer app and a source of
  "inaccurate shot charts" friction (TurboStats guide). Defer as planned.
- **(Minor) the name.** "Courtside by SportsTG" is an existing Stack Sports basketball
  live-scoring app ([App Store](https://apps.apple.com/us/app/-/id1198044571)). This
  only matters if Courtside is ever published.

## Sources

Vendor documentation and announcements

- GameChanger, Basketball Scorekeeping help article, league-hosted printout captured
  2025-03-17: <https://cdn4.sportngin.com/attachments/document/46ae-3373273/Basketball_Scorekeeping___GameChanger.pdf>
  (original: <https://help.gc.com/hc/en-us/articles/360051504411>, blocked to automated readers)
- GameChanger, Logical stat flows (2025-08-14): <https://gc.com/post/logical-stat-flows>
- GameChanger, Opponent scorekeeping for basketball (2025-12-08): <https://gc.com/post/opponent-scorekeeping-for-basketball>
- GameChanger, Basketball feature updates fall 2026 (2026-09-30): <https://gc.com/post/basketball-feature-updates-fall-2026>
- GameChanger, Basketball product page: <https://gc.com/basketball>
- GameChanger, Stream and score on a single device (Mar 2025): <https://gc.com/post/stream-and-score-on-a-single-device-for-basketball>
- GameChanger help, Offline Scorekeeping (via search index): <https://help.gc.com/hc/en-us/articles/360030864752-Offline-Scorekeeping>
- GameChanger help, Scorekeeping and Stats, handoff (via search index): <https://help.gc.com/hc/en-us/articles/360039839812-Scorekeeping-and-Stats>
- GameChanger help, opponent tracking (via search index): <https://help.gc.com/hc/en-us/articles/30677010233613>
- MarketScale, GameChanger tiered scorekeeping (2026-10-02): <https://www.marketscale.com/industries/sports-entertainment/gamechanger-adds-tiered-scorekeeping-highlight-pages-and-club-messaging-for-basketball>
- Hudl Assist basketball: <https://www.hudl.com/products/assist/basketball>
- Hudl Assist FAQ: <https://www.hudl.com/en_gb/products/assist/faq>
- Hudl support index document listing Assist articles (unknown athletes): <https://docs.google.com/document/d/11WJG4cyzk4S2cB8sMJGDZCDa99iUKoBKOTGxnhXq5aE/export?format=pdf>
- iScore Basketball training: <https://iscoresports.com/basketball/training.php>
- Hoopsalytics scoring tour: <https://hoopsalytics.com/tour/scoring.php>
- Hoopsalytics action tagging: <https://hoopsalytics.com/tour/action-tagging.php>
- TeamSnap, Enter Player Stats (updated 2026-03-09): <https://helpme.teamsnap.com/article/678-enter-player-stats>
- MaxPreps, Sync stats from GameChanger (via search index): <https://support.maxpreps.com/hc/en-us/articles/4409903717659-Sync-Stats-from-GameChanger-to-MaxPreps>
- MaxPreps, How to import from MaxStats (via search index): <https://support.maxpreps.com/hc/en-us/articles/360037974193-How-to-import-from-MaxStats>
- FIBA LiveStats product page: <https://about.fiba.basketball/en/services/data-and-video-solutions/fiba-live-stats>
- LiveStats v7 Action Log live editing (login-walled; via search index): <https://sportingpulse.freshdesk.com/support/solutions/articles/9000126485-livestats-version-7-action-log-live-editing>
- LiveStats v7 predictive workflows, scoring actions (login-walled; via search index): <https://sportingpulse.freshdesk.com/support/solutions/articles/9000126390-livestats-version-7-predictive-workflows-scoring-actions>
- LiveStats v7 flagged actions (login-walled; via search index): <https://sportingpulse.freshdesk.com/support/solutions/articles/9000157478--livestats-version-7-flagged-actions>
- FIBA Organizer post-game edits (via search index): <https://sportingpulse.freshdesk.com/support/solutions/articles/9000105845-how-to-import-match-statistics-from-fiba-livestats>
- TurboStats live scoring guide: <https://id3474.securedata.net/turbostats/support/docs/livegamebasketball.pdf>
- Action Network on NBA stat keeping (2022-02-02): <https://www.actionnetwork.com/nba/nba-downplays-role-stat-keeping-accuracy-props-go-mainstream-system-constructed-catch-everything>
- ESPN, Stat corrections: <https://support.espn.com/hc/en-us/articles/360056679592-Stat-corrections>

App Store listings (reviews read through Apple's public feed,
`https://itunes.apple.com/us/rss/customerreviews/page=N/id=ID/sortby=mostrecent/json`, on 2026-11-07)

- GameChanger: <https://apps.apple.com/us/app/id1308415878>
- iScore Basketball Scorekeeper: <https://apps.apple.com/us/app/id319581197>
- Easy Stats for Basketball: <https://apps.apple.com/us/app/id561687907>
- Basketball Stats Assistant: <https://apps.apple.com/us/app/id1513397355>
- Basketball Simple Stat Tracker: <https://apps.apple.com/us/app/id1224378809>
- Breakthrough Stats: <https://apps.apple.com/us/app/id589626454>
- MaxStats – Basketball: <https://apps.apple.com/us/app/id923893903>
- MaxPreps: <https://apps.apple.com/us/app/id980665604>
- Hudl Sideline: <https://apps.apple.com/us/app/id988525789>
- Courtside by SportsTG: <https://apps.apple.com/us/app/-/id1198044571>
