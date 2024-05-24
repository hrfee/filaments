import { Modal } from "./modules/modal.js";
import { BoardData, BoardSummary } from "./board.js";

export class BoardLoader {
    private _fileButton: HTMLButtonElement;
    private _nytButton: HTMLButtonElement;
    private _modal: Modal;
    private _boardList: HTMLElement;
    private _getBoardsFunc: () => void;
    private _downloadFunc: (date: string, then: (board: string) => void) => void;
    private _loadFunc: (newBoard: string) => void;

    private _summaries: BoardSummary[];

    constructor(modal: HTMLElement, fileButton: HTMLButtonElement, nytButton: HTMLButtonElement, boardList: HTMLElement, getBoardsFunc: () => void, downloadFunc: (date: string, then: (board: string) => void) => void, loadFunc: (newBoard: string) => void) {
        this._fileButton = fileButton;
        this._nytButton = nytButton;
        this._modal = new Modal(modal, false);
        this._boardList = boardList;
        this._getBoardsFunc = getBoardsFunc;
        this._downloadFunc = downloadFunc;
        this._loadFunc = loadFunc;

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
    }

    appendSummary = (summary: BoardSummary) => {
        this._summaries.push(summary);
        let tr = document.createElement("tr");
        tr.innerHTML = `
        <td>${summary.date}</td>
        <td>${summary.clue}</td>
        <td>${summary.editor}</td>
        <td><button class="button ~info @low download-board">Download</button></td>
        `;
        const dlButton = tr.querySelector("button.download-board") as HTMLButtonElement;
        dlButton.onclick = () => {
            this._downloadFunc(summary.date, this._loadFunc);
            this._modal.close();
        };
        this._boardList.appendChild(tr);
    }
}
