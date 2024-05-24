# "filaments"

![main page](images/main.png)

Re-implementation of the [NYT Strands](https://www.nytimes.com/games/strands) game, with some multiplayer functionality, and the ability to play past games.

Uses the same board files as the original, which can be sourced from https://www.nytimes.com/games-assets/strands/. 

The web-based game can operate mostly without external dependency, provided a board `.json` file.
A server facilitates multiplayer games within "rooms", as well as quick access to boards from NYT, which are downloaded and cached on request.

## the game

Like a crossword, except words aren't arranged in straight lines, a rough clue is given, and the true theme is included in the board, spanning it from left-right or top-bottom (dubbed a "Spangram" by the original, and here). Hints are also available, once you've found enough valid, but unrelated words on the board.

Click and drag across letters to select them, then release to end your guess. Alternatively, tap each letter, then tap the last a second time to end the guess.

Once 3 unrelated words have been found, the progress bar over the "Get hint" button will fill, and clicking will highlight the words in one of the answers.

## the server

Clone the code, and compile `serv.go`:
```shell
$ go build serv.go
$ ./serv <IP> <port>
```
Boards will be cached upon request to `boards.json`. They will not be deleted over time, so make sure this file doesn't get too big.

## the client

Once you know the address the server's running on (and taken reverse proxying into consideration), open up `ts/main.ts`, and change the line:
```typescript
new MultiplayerClient("ws://0.0.0.0:8802"),
```
to use the address and port appropriate. If reverse proxying with HTTPS, make sure to change `ws://` to `wss://`.

Then run `make` (ensure node/npm is installed).

Web assets will be placed in `out/`. Half the stuff in there might not be necessary, most of this project was ripped out of another. They are **not** hosted by the game server, so use something like NGINX
