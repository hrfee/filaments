package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/lithammer/shortuuid/v4"
)

const (
	BOARD_CACHE = "boards.json"
)

type Message string

const (
	// Inputs (i...) without a \n are those which include args.
	iHello             Message = "HELLO\n"
	iHelloExistingUser         = "HELLO"
	oHello                     = "HELLO %s %s\n" // UID and Key
	iNewRoom                   = "NEWROOM"       // Args: UID, Key
	oNewRoom                   = "NEWROOM %s\n"  // RID
	iListRooms                 = "ROOMS\n"
	oListRooms                 = "ROOM %s %d\n"   // RID and playercount
	iJoinRoom                  = "JOIN"           // Args: UID, Key, RID
	iLeaveRoom                 = "LEAVE"          // Args: UID, Key
	iSetBoard                  = "SETBOARD"       // Args: UID, Key, b64-ed board JSON string
	iGetBoard                  = "BOARD"          // Args: UID, Key
	oGetBoard                  = "BOARD %s\n"     // Board JSON
	iGetState                  = "GETSTATE"       // Args: UID, Key
	oReqStateFromHost          = "HOSTSTATE %s\n" // Sent to host to request board state, arg: src UID
	ioThemeWord                = "TWORD %s\n"     // Theme word, forwarded from host to client.
	ioSpangram                 = "SPANGRAM\n"
	iDownloadBoard             = "DLBOARD" // Args: Date YYYY-MM-DD
	iBoardSummaries            = "BOARDSUMMARIES\n"
	oBoardSummaries            = "BOARDSUMMARY %s %s %s\n" // Date, b64 clue, b64 editor.

	// Here, the inputs are sent by the client expecting no response,
	// And the outputs are sent by the server to the client spontaneously once in a room.
	iGuess    = "GUESS" // Args: UID, Key, x, y
	oGuess    = "GUESS %d %d\n"
	iEndGuess = "ENDGUESS" // Args: UID, Key
	oEndGuess = "ENDGUESS\n"
	iHint     = "HINT" // Args: UID, Key
	oHint     = "HINT\n"

	iForward = "FORWARD" // Args: UID, Key, Target UID, Message

	oSuccess  = "COOL\n"
	oFail     = "NO\n"
	oStart    = "START\n"
	oFinished = "END\n"
	oInvalid  = "INVALID\n"

	oNewHost      = "NEWHOST\n"
	oPlayerJoined = "JOINED %s\n"
	oPlayerLeft   = "LEFT %s\n"
)

type UID string
type UserKey string
type RID string

type User struct {
	uid  UID
	key  UserKey
	nick string
	room RID
}

type Room struct {
	rid   RID
	host  UID
	board string
}

func (r *Room) collectUsers(g *GameServer) []UID {
	var users []UID
	for _, u := range g.users {
		if u.room == r.rid {
			users = append(users, u.uid)
		}
	}
	return users
}

func (r *Room) countUsers(g *GameServer) (count int) {
	count = 0
	for _, u := range g.users {
		if u.room == r.rid {
			count++
		}
	}
	return
}

func (r Room) ShouldDelete(g *GameServer) bool {
	return r.countUsers(g) <= 0
}

func (g *GameServer) DeleteRoom(rid RID) {
	r := g.rooms[rid]
	uids := r.collectUsers(g)
	for _, uid := range uids {
		u := g.users[uid]
		u.room = ""
		g.users[uid] = u
	}
	delete(g.rooms, rid)
}

type GameServer struct {
	upgrader    websocket.Upgrader
	addr        string
	port        int
	users       map[UID]User
	rooms       map[RID]Room
	connections map[UID](chan CrossSessionMessage)
	boards      *BoardCache
}

type MsgType int

const (
	mGuess MsgType = iota
	mEndGuess
	mReqState
	mForward
	mNewHost
	mNewBoard
	mPlayerJoined
	mPlayerLeft
	mHint
)

type CrossSessionMessage struct {
	x, y    int
	msgType MsgType
	data    string
	src     UID
}

func (g *GameServer) CrossSessionMonitor(c *websocket.Conn, uid UID) {
	for msg := range g.connections[uid] {
		switch msg.msgType {
		case mEndGuess:
			g.resp(c, oEndGuess)
		case mGuess:
			g.resp(c, oGuess, msg.x, msg.y)
		case mHint:
			g.resp(c, oHint)
		case mReqState:
			// log.Printf("ReqState received from %s for host %s!\n", msg.src, uid)
			g.resp(c, oReqStateFromHost, msg.src)
		case mForward:
			// log.Printf("Forward requested to %s: \"%s\"\n", uid, msg.data)
			g.resp(c, msg.data)
		case mNewHost:
			// log.Printf("Host being assigned to \"%s\"", uid)
			g.resp(c, oNewHost)
		case mPlayerJoined:
			g.resp(c, oPlayerJoined, msg.src)
		case mPlayerLeft:
			g.resp(c, oPlayerLeft, msg.src)
		case mNewBoard:
			// I'm Lazy
			if u, ok := g.users[uid]; ok {
				g.getBoard(c, u)
			}
		default:
			log.Printf("Received unknown CrossSessionMessage: %v\n", msg.msgType)
		}
	}
}

func (g *GameServer) UserLeftRoom(uid UID) {
	u, ok := g.users[uid]
	if !ok {
		return
	}
	rid := u.room
	u.room = ""
	g.users[uid] = u
	if rid == "" {
		return
	}
	room := g.rooms[rid]
	if room.ShouldDelete(g) {
		log.Printf("Deleting room \"%s\"\n", rid)
		g.DeleteRoom(rid)
		return
	}
	users := room.collectUsers(g)
	if room.host == uid && len(users) != 0 {
		for _, v := range users {
			ch, ok := g.connections[v]
			if !ok {
				continue
			}
			room.host = v
			g.rooms[rid] = room
			ch <- CrossSessionMessage{
				msgType: mNewHost,
			}
		}
	}
	g.broadcastToRoom(room, CrossSessionMessage{
		msgType: mPlayerLeft,
		src:     uid,
	})
}

func (g *GameServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	c, err := g.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Failed HTTP => WS: %v\n", err)
		return
	}
	defer c.Close()
	var uid UID = "?"
	for {
		mt, msg, err := c.ReadMessage()
		if err != nil {
			log.Printf("Connection closed to \"%s\"\n", uid)
			if uid != "" {
				delete(g.connections, uid)
				g.UserLeftRoom(uid)
			}
			return
		}
		if mt == websocket.BinaryMessage {
			// FIXME: Log this?
			g.resp(c, oInvalid)
			return
		}
		// Split into 4, assuming (most) messages are "COMMAND UID Key Args"
		components := strings.SplitN(string(msg), " ", 4)
		if len(components) > 1 {
			components[len(components)-1] = strings.TrimSuffix(components[len(components)-1], "\n")
		}
		inp := Message(components[0])
		switch inp {
		case iHello:
			uid = g.cmdHello(c)
			log.Printf("\"%s\": HELLO\n", uid)
			if _, ok := g.connections[uid]; !ok {
				g.connections[uid] = make(chan CrossSessionMessage)
				go g.CrossSessionMonitor(c, uid)
			}
		case iHelloExistingUser:
			uid = g.cmdHelloExistingUser(c, components)
			log.Printf("\"%s\": HELLO (existing user)\n", uid)
			if uid != "" {
				if _, ok := g.connections[uid]; !ok {
					g.connections[uid] = make(chan CrossSessionMessage)
					go g.CrossSessionMonitor(c, uid)
				}
			}
		case iNewRoom:
			log.Printf("\"%s\": NEWROOM\n", uid)
			g.cmdNewRoom(c, components)
		case iListRooms:
			log.Printf("\"%s\": LISTROOMS\n", uid)
			g.cmdListRooms(c)
		case iJoinRoom:
			log.Printf("\"%s\": JOINROOM\n", uid)
			g.cmdJoinRoom(c, components)
		case iLeaveRoom:
			log.Printf("\"%s\": LEAVEROOM\n", uid)
			g.cmdLeaveRoom(c, components)
		case iSetBoard:
			log.Printf("\"%s\": SETBOARD\n", uid)
			g.cmdSetBoard(c, components)
		case iGetBoard:
			log.Printf("\"%s\": GETBOARD\n", uid)
			g.cmdGetBoard(c, components)
		case iBoardSummaries:
			log.Printf("\"%s\": BOARDSUMMARIES", uid)
			g.cmdBoardSummaries(c)
		case iGuess:
			log.Printf("\"%s\": GUESS\n", uid)
			g.cmdGuess(c, components)
		case iEndGuess:
			log.Printf("\"%s\": ENDGUESS\n", uid)
			g.cmdEndGuess(c, components)
		case iHint:
			log.Printf("\"%s\": HINT\n", uid)
			g.cmdHint(c, components)
		case iForward:
			log.Printf("\"%s\": FORWARD", uid)
			g.cmdForward(c, components)
		case iGetState:
			log.Printf("\"%s\": GETSTATE", uid)
			g.cmdGetState(c, components)
		case iDownloadBoard:
			log.Printf("\"%s\": DLBOARD", uid)
			g.cmdDownloadBoard(c, components)
		default:
			g.resp(c, oInvalid)
		}
	}
}

func (g *GameServer) resp(c *websocket.Conn, r string, subs ...interface{}) {
	c.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf(r, subs...)))
}

func (g *GameServer) cmdHello(c *websocket.Conn) UID {
	// FIXME: Dont use shortuuid for both identifier and "password"
	uuid := UID(shortuuid.New())
	uk := UserKey(shortuuid.New())
	g.users[uuid] = User{
		uid:  uuid,
		key:  uk,
		nick: "",
		room: "",
	}
	g.resp(c, oHello, uuid, uk)
	fmt.Printf("New user, assigned \"%s\"", uuid)
	return uuid
}

func (g *GameServer) cmdHelloExistingUser(c *websocket.Conn, args []string) UID {
	u := g.auth(args)
	if u == nil {
		g.resp(c, oInvalid)
		return ""
	}
	g.resp(c, oHello, u.uid, u.key)
	return u.uid
}

func (g *GameServer) auth(args []string) *User {
	if len(args) < 3 {
		return nil
	}
	// Trim newline is auth things are the only argument
	key := UserKey(strings.TrimSuffix(args[2], "\n"))
	if u, ok := g.users[UID(args[1])]; ok && u.key == key {
		return &u
	}
	return nil
}

func (g *GameServer) cmdNewRoom(c *websocket.Conn, args []string) {
	u := g.auth(args)
	if u == nil {
		g.resp(c, oInvalid)
		return
	}
	rid := RID(shortuuid.New())
	g.rooms[rid] = Room{
		rid:   rid,
		host:  u.uid,
		board: "",
	}
	g.resp(c, oNewRoom, rid)
}

func (g *GameServer) cmdListRooms(c *websocket.Conn) {
	for _, room := range g.rooms {
		g.resp(c, oListRooms, room.rid, room.countUsers(g))
	}
	g.resp(c, oFinished)
}

func (g *GameServer) cmdJoinRoom(c *websocket.Conn, args []string) {
	u := g.auth(args)
	if u == nil {
		g.resp(c, oInvalid)
		return
	}
	if len(args) < 4 {
		g.resp(c, oInvalid)
		return
	}
	rid := RID(args[3])
	room, ok := g.rooms[rid]
	if !ok {
		g.resp(c, oFail)
		return
	}
	if u.room != "" {
		g.UserLeftRoom(u.uid)
	}
	u.room = rid
	g.users[u.uid] = *u
	g.resp(c, oSuccess)
	g.broadcastToRoom(room, CrossSessionMessage{
		msgType: mPlayerJoined,
		src:     u.uid,
	}, u.uid)
}

func (g *GameServer) cmdLeaveRoom(c *websocket.Conn, args []string) {
	u := g.auth(args)
	if u == nil {
		g.resp(c, oInvalid)
		return
	}
	if u.room != "" {
		g.UserLeftRoom(u.uid)
	}
	g.resp(c, oSuccess)
}

func (g *GameServer) cmdSetBoard(c *websocket.Conn, args []string) {
	u := g.auth(args)
	if u == nil {
		g.resp(c, oInvalid)
		return
	}
	if len(args) < 4 || u.room == "" {
		g.resp(c, oInvalid)
		return
	}

	// Don't actually need to decode the board.
	// decodedBoard, err := base64.StdEncoding.DecodeString(args[3])
	// if err != nil {
	// 	g.resp(c, oFail)
	// 	return
	// }

	room, ok := g.rooms[u.room]
	if !ok {
		g.resp(c, oFail)
		return
	}
	// room.board = string(decodedBoard)
	room.board = args[3]
	g.rooms[u.room] = room
	g.resp(c, oSuccess)
	g.broadcastToRoom(room, CrossSessionMessage{
		msgType: mNewBoard,
	}, u.uid)
}

func (g *GameServer) cmdGetBoard(c *websocket.Conn, args []string) {
	u := g.auth(args)
	if u == nil {
		g.resp(c, oInvalid)
		return
	}
	g.getBoard(c, *u)
}

func (g *GameServer) getBoard(c *websocket.Conn, u User) {
	if u.room == "" {
		g.resp(c, oInvalid)
		return
	}
	room, ok := g.rooms[u.room]
	if !ok {
		g.resp(c, oFail)
		return
	}
	if room.board == "" {
		g.resp(c, oFail)
		return
	}
	g.resp(c, oGetBoard, room.board)
}

func dateToBoardFName(t time.Time) string {
	return fmt.Sprintf("%04d-%02d-%02d", t.Year(), t.Month(), t.Day())
}

func (g *GameServer) cmdBoardSummaries(c *websocket.Conn) {
	dayRange := 30
	day := time.Now()
	for i := 0; i < dayRange; i++ {
		date := dateToBoardFName(day)
		summary := g.boards.Get(date)
		if summary == nil {
			continue
		}
		g.resp(c, oBoardSummaries,
			summary.Date,
			base64.StdEncoding.EncodeToString([]byte(summary.Clue)),
			base64.StdEncoding.EncodeToString([]byte(summary.Editor)),
		)
		day = day.Add(time.Duration(-24 * time.Hour))
	}
}

func (g *GameServer) broadcastToRoom(r Room, msg CrossSessionMessage, skipUsers ...UID) {
	users := r.collectUsers(g)
	for _, roomUser := range users {
		skip := false
		for _, s := range skipUsers {
			if roomUser == s {
				skip = true
				break
			}
		}
		if skip {
			continue
		}
		g.connections[roomUser] <- msg
	}
}

func (g *GameServer) cmdGuess(c *websocket.Conn, args []string) {
	u := g.auth(args)
	if u == nil {
		g.resp(c, oInvalid)
		return
	}
	if u.room == "" {
		g.resp(c, oInvalid)
		return
	}
	if len(args) < 4 {
		g.resp(c, oInvalid)
		return
	}
	room, ok := g.rooms[u.room]
	if !ok {
		g.resp(c, oFail)
		return
	}
	// args are split into max 4, so x and y are in the last one.
	xy := strings.Split(args[3], " ")
	x, _ := strconv.Atoi(xy[0])
	y, _ := strconv.Atoi(xy[1])
	g.broadcastToRoom(room, CrossSessionMessage{
		x: x, y: y,
		msgType: mGuess,
	}, u.uid)
}

func (g *GameServer) cmdEndGuess(c *websocket.Conn, args []string) {
	u := g.auth(args)
	if u == nil {
		g.resp(c, oInvalid)
		return
	}
	if u.room == "" {
		g.resp(c, oInvalid)
		return
	}
	room, ok := g.rooms[u.room]
	if !ok {
		g.resp(c, oFail)
		return
	}
	g.broadcastToRoom(room, CrossSessionMessage{
		msgType: mEndGuess,
	}, u.uid)
}

func (g *GameServer) cmdHint(c *websocket.Conn, args []string) {
	u := g.auth(args)
	if u == nil {
		g.resp(c, oInvalid)
		return
	}
	if u.room == "" {
		g.resp(c, oInvalid)
		return
	}
	room, ok := g.rooms[u.room]
	if !ok {
		g.resp(c, oFail)
		return
	}
	g.broadcastToRoom(room, CrossSessionMessage{
		msgType: mHint,
	}, u.uid)
}

func (g *GameServer) cmdForward(c *websocket.Conn, args []string) {
	u := g.auth(args)
	if u == nil {
		g.resp(c, oInvalid)
		return
	}
	if len(args) < 4 {
		g.resp(c, oInvalid)
		return
	}
	targetAndContent := strings.SplitN(args[3], " ", 2)
	target := UID(targetAndContent[0])
	ch, ok := g.connections[target]
	if !ok {
		// log.Printf("\"%s\": Forward failed: target \"%s\" not found\n", args[1], targetAndContent[0])
		g.resp(c, oFail)
		return
	}

	// log.Printf("Forwarding to \"%s\": %s\n", targetAndContent[0], targetAndContent[1])
	ch <- CrossSessionMessage{
		msgType: mForward,
		data:    targetAndContent[1],
	}
}

func (g *GameServer) cmdGetState(c *websocket.Conn, args []string) {
	u := g.auth(args)
	if u == nil {
		g.resp(c, oInvalid)
		return
	}
	if u.room == "" {
		g.resp(c, oInvalid)
		return
	}
	room, ok := g.rooms[u.room]
	if !ok {
		g.resp(c, oFail)
		return
	}
	if room.host == "" {
		g.resp(c, oFail)
		return
	}
	ch, ok := g.connections[room.host]
	if !ok {
		g.resp(c, oFail)
		return
	}
	ch <- CrossSessionMessage{
		msgType: mReqState,
		src:     u.uid,
	}
}

func (g *GameServer) cmdDownloadBoard(c *websocket.Conn, args []string) {
	board := g.boards.GetJSON(args[1])
	if board == "" {
		g.resp(c, oFail)
		return
	}
	g.resp(c, oGetBoard, board)
}

func NewServer(address string, port int) *GameServer {
	g := GameServer{
		upgrader:    websocket.Upgrader{},
		addr:        address,
		port:        port,
		users:       map[UID]User{},
		rooms:       map[RID]Room{},
		connections: map[UID](chan CrossSessionMessage){},
		boards:      NewBoardCache(),
	}
	g.upgrader.CheckOrigin = func(r *http.Request) bool { return true }
	return &g
}

func (g *GameServer) Serve() {
	http.Handle("/", g)
	fullAddress := fmt.Sprintf("%s:%d", g.addr, g.port)
	log.Printf("Starting server @ \"%s\"", fullAddress)
	log.Fatal(http.ListenAndServe(fullAddress, nil))
}

type BoardCache struct {
	Summaries map[string]BoardSummary
	Boards    map[string]string
}

func NewBoardCache() *BoardCache {
	b := BoardCache{
		Summaries: map[string]BoardSummary{},
		Boards:    map[string]string{},
	}
	bc, err := os.ReadFile(BOARD_CACHE)
	if err != nil {
		return &b
	}
	json.Unmarshal(bc, &b)
	return &b
}

type BoardSummary struct {
	Date   string `json:"printDate"`
	Clue   string `json:"clue"`
	Editor string `json:"editor"`
}

func (b *BoardCache) Get(date string) *BoardSummary {
	if summary, ok := b.Summaries[date]; ok {
		return &summary
	}
	url := fmt.Sprintf("https://www.nytimes.com/games-assets/strands/%s.json", date)
	resp, err := http.Get(url)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil
	}
	bodyBytes, err := io.ReadAll(resp.Body)

	if err != nil {
		return nil
	}
	summary := BoardSummary{}
	err = json.Unmarshal(bodyBytes, &summary)
	if err != nil {
		return nil
	}
	encoded := base64.StdEncoding.EncodeToString(bodyBytes)
	b.Boards[date] = encoded
	b.Summaries[date] = summary
	b.ToFile(BOARD_CACHE)
	return &summary
}

func (b *BoardCache) GetJSON(date string) string {
	if board, ok := b.Boards[date]; ok {
		return board
	}
	url := fmt.Sprintf("https://www.nytimes.com/games-assets/strands/%s.json", date)
	resp, err := http.Get(url)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ""
	}
	bodyBytes, err := io.ReadAll(resp.Body)

	if err != nil {
		return ""
	}
	summary := BoardSummary{}
	err = json.Unmarshal(bodyBytes, &summary)
	if err != nil {
		return ""
	}
	encoded := base64.StdEncoding.EncodeToString(bodyBytes)
	b.Boards[date] = encoded
	b.Summaries[date] = summary
	b.ToFile(BOARD_CACHE)
	return encoded
}

func (b *BoardCache) ToFile(fname string) {
	data, err := json.Marshal(b)
	if err != nil {
		return
	}
	err = os.WriteFile(fname, data, 0666)
	if err != nil {
		log.Printf("Failed to store Boards: %v\n", err)
	}
}

func main() {
	addr := "0.0.0.0"
	port := 8802
	var err error
	if len(os.Args) >= 3 {
		addr = os.Args[1]
		port, err = strconv.Atoi(os.Args[2])
		if err != nil {
			log.Fatalf("Invalid port: \"%s\"\n", os.Args[2])
		}
	}
	g := NewServer(addr, port)
	g.Serve()
}
