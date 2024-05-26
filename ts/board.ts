export interface BoardData {
    printDate: string;
    id: number;
    editor: string;
    spangram: string;
    clue: string;
    startingBoard: string[];
    solutions: string[];
    themeCoords: { [theme: string]: number[][] }; // number[2][]
}

export interface BoardState {
    themeWordsFound: string[];
    spangramFound: boolean;
    spangramCoords: number[][];
    wordsToGetHint: number;
    currentGuess: number[][];
}

export interface BoardSummary {
    date: string;
    clue: string;
    editor: string;
}

export const defaultBoard: BoardData = {
    printDate: "2024-05-24",
    id: -1,
    editor: "Harvey Tindall",
    spangram: "ALRIGHTY",
    clue: "(Down)load a game below to start.",
    startingBoard: [
        "THIS-Y",
        "ISNT-T",
        "AREALH",
        "BOARDG",
        "LOAD-I",
        "O-E--R",
        "<N---L",
        "OKAY?A"
    ],
    "solutions": [
        "ALRIGHTY",
        "THIS",
        "ISNT",
        "REAL",
        "BOARD",
        "LOAD",
        "ONE",
        "OKAY",
        "BOAR",
        "EAR",
        "ALRIGHT",
        "LONE"
    ],
    "themeCoords": {
        "THIS": [[0, 0], [0, 1], [0, 2], [0, 3]],
        "ISNT": [[1, 0], [1, 1], [1, 2], [1, 3]],
        "REAL": [[2, 1], [2, 2], [2, 3], [2, 4]],
        "BOARD": [[3, 0], [3, 1], [3, 2], [3, 3], [3, 4]],
        "LOAD": [[4, 0], [4, 1], [4, 2], [4, 3]],
        "ONE": [[5, 0], [6, 1], [5, 2]],
        "OKAY": [[7, 0], [7, 1], [7, 2], [7, 3]]
    }
};
