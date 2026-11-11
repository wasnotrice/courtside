# Courtside

A stat tracker for school sports programs, starting with basketball: drill results at
practice and play-by-play stats in games, entered on a phone, with or without signal.

## People and teams

**Organization**:
A school. Everything in Courtside belongs to exactly one organization.
_Avoid_: School (in code), tenant, account

**Program**:
One sport for one gender at an organization, such as girls' basketball. It has its own
players, drills and teams.
_Avoid_: Sport, department

**Player**:
A person in a program who can appear in drill results and game plays.
_Avoid_: Athlete, student

**Team**:
One level within a program, such as varsity or JV. Each game is played by a team.
_Avoid_: Squad, level

**Roster entry**:
A player's place on one team for one season, with the jersey number worn there. A
player can be on more than one team in a season.
_Avoid_: Membership, active player

**Season**:
One school year at an organization, shared by all its programs. Rosters, records,
drill runs and season totals belong to a season.
_Avoid_: Year

**Opponent**:
The team on the other side of a game, named in free text. Courtside tracks its stats
only as team totals, never for individual opposing players.
_Avoid_: Other team, visitor

## Practice

**Drill**:
A repeatable practice exercise with a fixed kind, such as free throws or suicides.

**Kind**:
What a drill measures: makes out of shots, a count in a fixed time, or a time for fixed
reps. It never changes after the drill is created.
_Avoid_: Type

**Setup**:
The quantity fixed before a drill starts: shots taken, seconds allowed or reps run.

**Value**:
The quantity measured in a drill: makes, count or seconds.
_Avoid_: Score

**Drill run**:
One drill done at one practice, with its own setup.
_Avoid_: Run (alone; in basketball a run is a scoring streak), session

**Result**:
One player's value, and optionally their own setup, in one drill run.

**Matching game stat**:
The shot a makes drill practices, as it's counted in games: free throws, 2-point or
3-point shots. It lets practice be compared with games.
_Avoid_: Link, mapping

## Games

**Game**:
One game played by a team against an opponent on a date.
_Avoid_: Match

**Play**:
One stat credited during a game, such as a made 3, a rebound or a foul, to a player,
to the team as a whole, or to the opponent.
_Avoid_: Event, action, stat entry

**Assist**:
Credit to the player whose pass led to a made field goal. It's part of that made shot,
not a play of its own.

**Foul**:
A play charged to a player, to the bench, or to the opponent, with a type: personal,
offensive, technical or flagrant. An offensive foul also counts as a turnover.

**Foul drawn**:
Credit to our player who was fouled by the opponent. It's part of the opponent's foul,
not a play of its own.

**Game rules**:
The rules a game is played under: periods and their length, when team fouls reset, the
bonus and fouls to foul out. Each team has a default, and each game keeps its own copy.
_Avoid_: Settings, config

**Box score**:
A game's totals for each player, for the team and for the opponent, computed from its
plays.

**Period**:
A half, a quarter or an overtime, as the game rules say, named in full ("1st half",
"Overtime").
_Avoid_: H1, Q1

**Game status**:
Live while the game is played, final once it's over, reviewed once it's been checked
against film.

**Official score**:
The final score from the scorebook, entered when the game is final. When the plays
add up to something else, the game is flagged.
_Avoid_: Real score

**Season totals**:
A team's box scores added up over a season, for each player, as totals or per game.

**Games played**:
The games a player has any stat in. Courtside doesn't record minutes or who checked
in, so a player who played without a stat isn't counted.
_Avoid_: Appearances

## Sync

**Pending change**:
A change made on a phone that the server hasn't confirmed yet.
_Avoid_: Mutation (outside code), queued edit

**Rejection**:
A pending change the server refused, with the reason shown to the coach.
_Avoid_: Error, conflict

**Restore**:
Bringing back a game or drill run that another phone deleted, with what was recorded
into it, so changes refused because of the delete aren't lost.
_Avoid_: Undelete, recover

**Undo**:
Taking back the latest change made on this screen, on this phone.

**History**:
Every change to one row, by any phone, kept on the server. Any edit in it can be
reverted.
_Avoid_: Audit log
