import { Modal } from "./modules/modal.js";
import { whichAnimationEvent, notificationBox } from "./modules/common.js";
import { BoardData, BoardState, defaultBoard } from "./board.js";
import { MultiplayerClient, MultiplayerUI } from "./multi.js";
import { BoardLoader } from "./load.js";

interface window extends Window {
    animationEvent: string;
    notif: notificationBox;
    
}

declare var window: window;

window.animationEvent = whichAnimationEvent();
window.notif = new notificationBox(document.getElementById("notification-box") as HTMLDivElement, 5);

const EMPTY_GUESS = "_ _ _ _ _ _";
const GET_HINT = "Get hint";

class MessageBox {
    private _el: HTMLElement;
    private _timeout: number;
    private _animate: string;
    constructor(el: HTMLElement, animationClass = "animate-ping", defaultTimeout = 2000) {
        this._el = el;
        this._timeout = defaultTimeout;
        this._animate = animationClass;
    }
    msg = (msg: string, cssColor: string = "", timeout: number = -1) => {
        if (timeout == -1) timeout = this._timeout;
        this._el.textContent = msg;
        this._el.style.color = cssColor;
        setTimeout(() => {
            this._el.textContent = ``; 
            this._el.classList.remove(this._animate);
        }, timeout);
        this._el.style.cssText = this._el.style.cssText + `animation-duration: ${timeout}ms !important; animation-iteration-count: 1 !important;`;
        this._el.classList.add(this._animate);
    }
}

function coordsMatch(a: number[], b: number[]): boolean {
    return a[0] == b[0] && a[1] == b[1];
}

function validPositions(word: string, coords: number[][], char: string) {
    let out: number[][] = [];
    for (let i = 0; i < coords.length; i++) {
        if (word.at(i) == char) {
            out.push(coords[i]);
        }
    }
    return out;
}

class GameBoard {
    private _el: HTMLElement;
    private _clue: HTMLElement;
    private _guess: HTMLElement;
    private _board: BoardData;
    private _w: number;
    private _h: number;
    private _grid: HTMLDivElement[][];
    private _m: MultiplayerUI;
    private _bl: BoardLoader;

    private _formingGuess: boolean = false;
    private _inHover: boolean = false;
    private _mouseDown: boolean = false;
    private _selected: number[][] = []; // number[2][]
    private _clickStart: number[] = [-1, -1];
    private _clickCurrent: number[] = [-1, -1];

    private wordsToGetHint: number = 3;
    private _wordsRemainingForHint: number = -1;
    private _wordsFound = [];
    private _themeWordsFound = [];
    private _spangramFound = false;
    private _spangramCoords: number[][] = [];
    private _themeWordCount: number = 0;
    private _hintButton: HTMLButtonElement;
    private _foundText: HTMLElement;
    
    private _mb: MessageBox;

    constructor(el: HTMLElement, clue: HTMLElement, guess: HTMLElement, wordCount: HTMLElement, hintButton: HTMLElement, messageBox: HTMLElement, board: BoardData) {
        this._el = el;
        this._clue = clue;
        this._guess = guess;
        this._mb = new MessageBox(messageBox);
        this._foundText = wordCount;
        this._hintButton = hintButton as HTMLButtonElement;

        this._hintButton.onclick = this._useHint;

        this._wordsRemainingForHint = this.wordsToGetHint;
        this._m = new MultiplayerUI(
            new MultiplayerClient("ws://0.0.0.0:8802"),
            document.getElementById("modal-rooms"),
            document.getElementById("room-list"),
            document.getElementById("room-code"),
            document.getElementById("rooms-button") as HTMLButtonElement,
            document.getElementById("copy-room-link") as HTMLButtonElement,
            document.getElementById("new-room") as HTMLButtonElement,
            (board: BoardData) => {
                this._reloadBoard(board);
                this.render();
            }
        );

        this._m.cli.onGuess = (x: number, y: number) => {
            let el = this._grid[y][x];
            this._addToGuess(el, x, y, false, false, true);
        };
        this._m.cli.onEndGuess = () => {
            this._endGuess(true);
            this.renderGuess();
        };
        this._m.cli.onBoardRequest = (): BoardState => {
            return {
                themeWordsFound: this._themeWordsFound,
                spangramFound: this._spangramFound,
                spangramCoords: this._spangramCoords,
                wordsToGetHint: this._wordsRemainingForHint
            };
        }
        this._m.cli.onBoardStateThemeWord = (w: string) => {
            this.selectThemeWordByCoords(w, this._board.themeCoords[w]);
        };
        this._m.cli.onBoardStateSpangram = (coords: number[][]) => {
            this.selectSpangramByCoords(coords);
        };
        this._m.cli.onBoardStateWordsToGetHint = (w: number) => {
            this._wordsRemainingForHint = w;
            this.updateWordCount();
        };

        this._bl = new BoardLoader(
            document.getElementById("modal-nyt"),
            document.getElementById("load-file") as HTMLButtonElement,
            document.getElementById("load-nyt") as HTMLButtonElement,
            document.getElementById("board-list"),
            this._m.cli.cmdBoardSummaries,
            this._m.cli.cmdDownloadBoard,
            (newBoard: string) => {
                let parsedBoard = JSON.parse(newBoard) as BoardData;
                this.changeBoard(parsedBoard);
                this._m.cli.cmdSetBoard(newBoard);
            }
        );
        
        this._m.cli.onBoardSummaryAdded = this._bl.appendSummary;

        this._reloadBoard(board);

        this.render();
        // console.log("Grid:", this._grid);
    }

    private _reloadBoard(board: BoardData) {
        this._board = board;
        this._themeWordCount = Object.keys(this._board.themeCoords).length;
        this._w = this._board.startingBoard[0].length;
        this._h = this._board.startingBoard.length;
        this._grid = [];
        this._selected = [];
        this._formingGuess = false;
        this._inHover = false;
        this._mouseDown = false;
        this._selected = [];
        this._clickStart = [-1, -1];
        this._clickCurrent = [-1, -1];
        this._wordsRemainingForHint = this.wordsToGetHint;
        this._wordsFound = [];
        this._themeWordsFound = [];
        this._spangramFound = false;
        this._spangramCoords = [];

        this._m.board = JSON.stringify(this._board);
    }

    changeBoard = (board: BoardData) => {
        this._reloadBoard(board);
        this.render();
    };

    private resetChar = (el: HTMLElement, x: number, y: number) => {
        el.innerHTML = `<div class="relative z-10">${this._board.startingBoard[y].at(x)}</div>`;
    };

    render = () => {
        this._el.textContent = ``;
        
        this._guess.textContent = EMPTY_GUESS;
        // pre-create grid arrays, since the page layout doesn't follow the internal representation
        for (let y = 0; y < this._h; y++) {
            this._grid.push([]);
        }
        for (let x = 0; x < this._w; x++) {
            const col = document.createElement("div") as HTMLDivElement;
            col.classList.add("flex", "flex-col", "justify-between");
            for (let y = 0; y < this._h; y++) {
                const char = this._board.startingBoard[y].at(x);
                const containerEl = document.createElement("div");
                containerEl.classList.add("m-2");
                const chEl = document.createElement("div");
                chEl.setAttribute("data-x", ""+x);
                chEl.setAttribute("data-y", ""+y);
                chEl.classList.add("char", "font-bold", "w-8", "h-8", "rounded-full", "flex", "justify-center", "items-center");
                chEl.innerHTML = `<div class="relative z-10">${char}</div>`;
                // containerEl.addEventListener("mousedown", () => this._onMouseDown(chEl, x, y));
                // containerEl.addEventListener("touchstart", () => this._onMouseDown(chEl, x, y));
                containerEl.addEventListener("pointerdown", () => this._onMouseDown(chEl, x, y));
                // containerEl.addEventListener("mousemove", () => this._onMouseMove(chEl, x, y));
                // containerEl.addEventListener("touchmove", () => this._onMouseMove(chEl, x, y));
                containerEl.addEventListener("pointermove", (e: MouseEvent) => this._onMouseMove(e, chEl, x, y));
                containerEl.appendChild(chEl);
                col.appendChild(containerEl);
                this._grid[y].push(chEl);
            }
            this._el.appendChild(col);
        }

        // Let go of mouse might be between elements, but we can figure out the last one touched anyway.
        // document.addEventListener("mouseup", this._onMouseUp);
        // document.addEventListener("touchend", this._onMouseUp);
        document.addEventListener("pointerup", this._onMouseUp);

        this._clue.textContent = this._board.clue; 
        this.updateWordCount();
    };

    private _onMouseDown = (el: HTMLElement, x: number, y: number) => {
        this._mouseDown = true;
        this._inHover = false;
        this._formingGuess = true;
        this._clickStart = [x, y];
        this._clickCurrent = [x, y];
        this._addToGuess(el, x, y, false, false);
        console.log("down on", x, ", ", y);
    };
    private _onMouseMove = (e: MouseEvent, el: HTMLElement, x: number, y: number) => {
        // Note: pointermove/touchmove will fire this on the initial pressed element, so as a workaround we can calculate from its coords.
        if (this._clickStart[0] == x && this._clickStart[1] == y) {
            let clickEl = document.elementFromPoint(e.clientX, e.clientY);
            // This, the child element or parent will have x and y attributes we can use
            if (!clickEl.hasAttribute("data-x")) {
                if (clickEl.parentElement.hasAttribute("data-x")) clickEl = clickEl.parentElement;
                else if (clickEl.childElementCount != 0 && clickEl.children[0].hasAttribute("data-x")) clickEl = clickEl.children[0];
            }
            if (!clickEl.hasAttribute("data-x")) return;
            x = +(clickEl.getAttribute("data-x"));
            y = +(clickEl.getAttribute("data-y"));
            el = clickEl as HTMLElement;
        }
        if (!this._mouseDown || !this._formingGuess || (this._clickCurrent[0] == x && this._clickCurrent[1] == y)) return;
        this._clickCurrent = [x, y];
        console.log("move over", x, ", ", y);
        if (this._clickStart[0] != x || this._clickStart[1] != y) {
            this._inHover = true;
            this._addToGuess(el, x, y, false, true);
        }
    };
    private _onMouseUp = () => {
        if (!this._formingGuess) return;
        const x = this._clickCurrent[0];
        const y = this._clickCurrent[1];
        const el = this._grid[y][x];
        this._mouseDown = false;
        console.log("up on", x, ", ", y, "was drag:", this._inHover);
        if (this._inHover) {
            this._addToGuess(el, x, y, true, true);
        }
    };

    private _addToGuess(el: HTMLElement, x: number, y: number, end: boolean, drag: boolean, remote: boolean = false) {
        if (el.classList.contains("valid") || el.classList.contains("spangram")) return;
        if (!remote) this._m.cli.cmdGuess(x, y);
        let validity = this.validNextChar(el, x, y);
        // console.log("clicked", el.textContent, `at y,x ${y},${x}, validity: ${validity}, end: ${end}`);
        if (validity == 2 || end) {
            this._endGuess();
        } else if (validity == 0) {
            this._deselect(el, x, y, !drag);
        } else if (validity == -1) {
            this._clear();
            this.append(x, y, el);
        } else if (validity == 1) {
            this.append(x, y, el);
        }
        this.renderGuess();
    }

    private _deselect(el: HTMLElement, x: number, y: number, inclusive: boolean = true) {
        let newSelected = [];
        let foundEnd = false;
        for (let i = 0; i < this._selected.length; i++) {
            let yx = this._selected[i];
            if (inclusive && !foundEnd && yx[0] == y && yx[1] == x) {
                foundEnd = true;
            }
            if (!foundEnd) {
                newSelected.push(yx);
            } else {
                this._grid[yx[0]][yx[1]].classList.remove("selected");
                this.resetChar(this._grid[yx[0]][yx[1]], yx[1], yx[0]);
            }
            if (!inclusive && !foundEnd && yx[0] == y && yx[1] == x) {
                foundEnd = true;
            }
        }
        this._selected = newSelected;
    };

    private _clear(keepHints = true, keepConnectors = false) {
        // console.log("clear!");
        for (let i = 0; i < this._selected.length; i++) {
            let yx = this._selected[i];
            this._grid[yx[0]][yx[1]].classList.remove("selected");
            if (!keepHints) {
                this._grid[yx[0]][yx[1]].classList.remove("hinted");
            }
            if (!keepConnectors) {
                this.resetChar(this._grid[yx[0]][yx[1]], yx[1], yx[0]);
            }
        }
        this._selected = [];
        this.renderGuess();
    };

    // 2: user clicked the last char, confirming their guess. 0: previous symbol in current word, 1 = valid next word, -1 = not valid at all.
    private validNextChar(el: HTMLElement, x: number, y: number): number {
        if (this._selected.length == 0) return 1;
        let lastChar = this._selected[this._selected.length-1];
        for (let i = 0; i < this._selected.length; i++) {
            if (this._selected[i][0] == y && this._selected[i][1] == x) {
                if (i == this._selected.length-1) return 2;
                return 0;
            };
        }
        let valid = false;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (lastChar[0]+dy == y && lastChar[1]+dx == x) {
                    return 1;
                }
            }
        }
        return -1;
    };

    private _collectGuess = (): string => {
        let word = "";
        for (let i = 0; i < this._selected.length; i++) {
            word += this._board.startingBoard[this._selected[i][0]][this._selected[i][1]];
        }
        return word;
    };

    // 0 = Invalid. 1 = Valid word, you get a point towards hints. 2 = Valid theme word, 3 = Valid spangram.
    private validateGuess(word: string): number {
        let ret = 0;
        if (this._board.solutions.includes(word)) ret += 1;
        else return ret;
        if (this._board.spangram == word) {
            ret += 2;
            return ret;
        }
        if (word in this._board.themeCoords) {
            let coords = this._board.themeCoords[word];
            let match = true;
            for (let i = 0; i < coords.length; i++) {
                // NOTE: As illustrated in official board 2024-04-27 with "QUEEN", where thera are multiple valid guess "paths" along the same board positions, any are valid.
                // Hence we collect all possible positions and check them.
                let positions = validPositions(word, coords, word.at(i));
                let inAValidPosition = false;
                for (let j = 0; j < positions.length; j++) {
                    if (coordsMatch(coords[i], positions[j])) {
                        inAValidPosition = true;
                        break;
                    }
                }
                if (!inAValidPosition) {
                    match = false;
                    break;
                }
            }
            if (match) ret += 1;
        }
        return ret;
    }

    private addConnector(el: HTMLElement, elCoord: number[], prevCoord: number[]) {
        let deltaY = elCoord[0] - prevCoord[0];
        let deltaX = elCoord[1] - prevCoord[1];
        let con = document.createElement("div");
        con.classList.add("connector");
        let conClass = "";
        if (deltaY > 0) conClass += "u";
        else if (deltaY < 0) conClass += "d";
        if (deltaX > 0) conClass += "l";
        else if (deltaX < 0) conClass += "r";
        if (conClass != "") con.classList.add(conClass);

        this.resetChar(el, elCoord[1], elCoord[0]);
        el.appendChild(con);
    }

    private append(x: number, y: number, el: HTMLElement) {
        let needsConnector = this._selected.length > 0;
        this._selected.push([y, x]);
        el.classList.add("selected");
        if (needsConnector) {
            this.addConnector(el, [y, x], this._selected[this._selected.length-2]);
        }
    }

    private _endGuess = (remote: boolean = false) => {
        // console.log("endGuess");
        if (!remote) this._m.cli.cmdEndGuess();
        this._formingGuess = false;
        this._inHover = false;
        if (this._selected.length == 1) return;
        let word = this._collectGuess();
        let guessValidity = this.validateGuess(word);
        if (guessValidity == 1) {
            if (!this._wordsFound.includes(word)) {
                this._wordsFound.push(word);
                this._wordsRemainingForHint -= 1;
            } else {
                this._mb.msg("Already done");
            }
            this._clear();
            this.updateWordCount();
        } else if (guessValidity == 2) {
            this._mb.msg("Nice!", "var(--color-valid)");
            this.selectThemeWordByCoords(word, this._selected);
        } else if (guessValidity == 3) {
            this._mb.msg("Spangram!", "var(--color-spangram)");
            this.selectSpangramByCoords(this._selected);
        } else {
            this._clear();
        }
    }

    selectThemeWordByCoords = (word: string, coords: number[][]) => {
        this._themeWordsFound.push(word)
        for (let i = 0; i < coords.length; i++) {
            const el = this._grid[coords[i][0]][coords[i][1]];
            el.classList.add("valid");
            if (i != 0) {
                this.addConnector(el, coords[i], coords[i-1]);
            }
        }
        this._clear(true, true);
        this.updateWordCount();
    }

    selectSpangramByCoords = (coords: number[][]) => {
        this._spangramFound = true;
        this._spangramCoords = coords;
        for (let i = 0; i < coords.length; i++) {
            const el = this._grid[coords[i][0]][coords[i][1]]
            el.classList.add("spangram");
            if (i != 0) {
                this.addConnector(el, coords[i], coords[i-1]);
            }
        }
        this._clear(true, true);
    }

    updateWordCount = () => {
        if (this._themeWordsFound.length == this._themeWordCount && this._spangramFound) {
            this._foundText.textContent = "You win!";
        } else {
            this._foundText.textContent = `${this._themeWordsFound.length}/${this._themeWordCount} theme words found.`;
        }

        let fillPct = this.wordsToGetHint - (this._wordsRemainingForHint < 0 ? 0 : this._wordsRemainingForHint);
        fillPct = (fillPct / this.wordsToGetHint) * 100;
        this._hintButton.disabled = this._wordsRemainingForHint > 0 || this._themeWordsFound.length == this._themeWordCount;

        let textContent = GET_HINT;
        this._hintButton.title = "";
        if (this._wordsRemainingForHint > 0) {
            // textContent += ` (${this._wordsRemainingForHint} words remaining)`;
            this._hintButton.title = `${this._wordsRemainingForHint} word${this._wordsRemainingForHint != 1 ? "s" : ""} remaining`;
            this._hintButton.disabled = true;
        } else { this._hintButton.disabled = false; }
        this._hintButton.innerHTML = `
            <div class="progress" style="width: ${fillPct}%;"></div>
            ${textContent}
        `;
    }

    renderGuess = () => {
        this._guess.textContent = this._selected.length == 0 ? EMPTY_GUESS : "";
        for (let i = 0; i < this._selected.length; i++) {
            this._guess.textContent += this._board.startingBoard[this._selected[i][0]][this._selected[i][1]];
        }
    };

    private _useHint = () => {
        let themeWord = "";
        for (const tw in this._board.themeCoords) {
            if (this._themeWordsFound.includes(tw)) continue;
            themeWord = tw;
            break;
        }
        for (const c of this._board.themeCoords[themeWord]) {
            this._grid[c[0]][c[1]].classList.add("hinted");
        }

        this._wordsRemainingForHint = this.wordsToGetHint;
        this.updateWordCount();
    }
}

// const date = new Date();
// const fname = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0") + ".json";
// console.log(fname);
// 
// const url = "https://www.nytimes.com/games-assets/strands/" + fname;
// 
// let currentBoard: BoardData;
// fetch(url).then(res => res.json()).then(out => {
//     currentBoard = out;
//     console.log(currentBoard);
// });

let b = new GameBoard(document.getElementById("board"), document.getElementById("clue"), document.getElementById("guess"), document.getElementById("found-text"), document.getElementById("hint-button"), document.getElementById("messagebox"), defaultBoard);
