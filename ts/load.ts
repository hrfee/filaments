import { Modal } from "./modules/modal.js";
import { notificationBox, addLoader, removeLoader } from "./modules/common.js";
import { BoardData, BoardSummary } from "./board.js";

interface window extends Window {
    notif: notificationBox;
}

declare var window: window;

export class BoardLoader {
    private _fileButton: HTMLButtonElement;
    private _nytButton: HTMLButtonElement;
    private _nytSpecific: HTMLElement;
    private _modal: Modal;
    private _boardList: HTMLElement;


    private _getBoardsFunc: () => void;
    private _downloadFunc: (date: string, then: (board: string) => void) => void;
    private _loadFunc: (newBoard: string) => void;

    private _summaries: BoardSummary[];

    constructor(modal: HTMLElement, fileButton: HTMLButtonElement, nytButton: HTMLButtonElement, nytSpecific: HTMLElement, boardList: HTMLElement, getBoardsFunc: () => void, downloadFunc: (date: string, then: (board: string) => void) => void, loadFunc: (newBoard: string) => void) {
        this._fileButton = fileButton;
        this._nytButton = nytButton;
        this._nytSpecific = nytSpecific;
        this._modal = new Modal(modal, false);
        this._boardList = boardList;
        this._getBoardsFunc = getBoardsFunc;
        this._downloadFunc = downloadFunc;
        this._loadFunc = (board: string) => {
            if (board == "") {
                window.notif.customError("failedDownload", "Couldn't download board.");
            } else {
                window.notif.customSuccess("boardDownloaded", "Board downloaded.");
            }
            loadFunc(board);
            this._modal.close();
        }

        this._fileButton.onclick = () => {
            let input = document.createElement("input") as HTMLInputElement;
            input.type = "file";
            input.onchange = (e: Event & { target: HTMLInputElement }) => {
                let reader = new FileReader();
                reader.readAsText(e.target.files[0], "UTF-8");
                reader.onload = (rE: any) => {
                    let newBoard = rE.target.result;
                    this._loadFunc(newBoard);
                };
            };
            input.click();
        };

        this._nytButton.onclick = () => {
            this._summaries = [];
            this._boardList.textContent = ``;
            this._getBoardsFunc();
            this._modal.show();
        }

        let nytSpecificButton = this._nytSpecific.querySelector("button") as HTMLButtonElement;
        let nytSpecificInput = this._nytSpecific.querySelector("input") as HTMLInputElement;
        const loadSpecific = () => {
            if (nytSpecificInput.value == "") return;
            addLoader(nytSpecificButton);
            this._downloadFunc(nytSpecificInput.value, (board: string) => {
                removeLoader(nytSpecificButton);
                this._loadFunc(board)
            });
        };
        nytSpecificButton.onclick = loadSpecific;
        nytSpecificInput.onkeyup = (event: KeyboardEvent) => {
            if (event.key == "Enter") loadSpecific();
        };
    }

    appendSummary = (summary: BoardSummary) => {
        this._summaries.push(summary);
        /*let s = document.createElement("tr");
        tr.innerHTML = `
        <td class="pl-0">${summary.date}</td>
        <td>${summary.clue}</td>
        <td>${summary.editor}</td>
        <td class="pr-0"><button class="button ~info @low download-board">Download</button></td>
        `; */
        let s = document.createElement("div");
        s.classList.add("card", "flex", "flex-col", "items-center", "gap-2");
        s.innerHTML = `
            <div class="support">${summary.date}</div>
            <div class="font-bold text-xl text-center">${summary.clue}</div>
            <div class="text-center" title="Editor: ${summary.editor}">
                ${summary.editor}
            </div>
            <button class="button ~info @low download-board">Download</button>
        `;
        const dlButton = s.querySelector("button.download-board") as HTMLButtonElement;
        dlButton.onclick = () => {
            addLoader(dlButton);
            this._downloadFunc(summary.date, (board: string) => {
                removeLoader(dlButton);
                this._loadFunc(board);
            });
        };
        this._boardList.appendChild(s);
    }
}
