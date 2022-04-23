const io = require('socket.io-client')
var events = require('events');
String.prototype.htmlDecode = function() {
   return this.replace(/\&amp\;/g, '\&').replace(/\&gt\;/g, '\>').replace(
         /\&lt\;/g, '\<').replace(/\&quot\;/g, '\'').replace(/\&\#39\;/g,
         '\'');/*from w  w  w.  j  ava2 s.c o m*/
};
module.exports.Client = class extends events.EventEmitter {
    constructor(username, color, kwargs={}) {
        super()
        this.__username = username
        this.__color = color
        this.settings = kwargs
        this.users = []
        if (kwargs['filterJoin'] === undefined) {
            kwargs['filterJoin'] = true
        }
        if (kwargs['spamBypass'] === undefined) {
            kwargs['spamBypass'] = true
        }
        if (kwargs.spamBypass) {
            this.spamCh = ['​', '‌']
            this.spamIn = 0
        }
        this.waitingFor = {}
        let _blocked = new Set()
        this.block_db_cb = function (t, v) {
            if (t === 'get') {
                return _blocked
            } else if (t === 'add'){
                _blocked.add(v)
            } else if (t === 'remove') {
                _blocked.delete(v)
            } else if (t === 'has') {
                return _blocked.has(v)
            }
        }
    }
    bulk_block(...args) {
        for (let value of args) {
            if (value instanceof Array) {
                this.bulk_block(...value)
            } else {
                this.block(value)
            }
        }
    }
    get blocked() {
        return this.block_db_cb('get')
    }
    block_db(cb) {
        this.block_db_cb = cb
    }
    block(user) {
        if (typeof user !== 'string') {
            user = user?.id
        }
        if (user === undefined) {
            throw Error("This isnt a user.")
        }

        this.block_db_cb('add', user)
    }
    unblock(user) {
        if (typeof user !== 'string') {
            user = user?.id
        }
        if (user === undefined) {
            throw Error("This isnt a user.")
        }
        
        this.block_db_cb('remove', user)
    }
    getUser(kw={}) {
        for (let user of this.users) {
            if (kw['id'] && kw.id !== user.id) {
                continue
            } 
            if (kw['name'] && kw.name !== user.name) {
                continue
            } 

            return user
        }
    }
    emit(name, ...args) {
        super.emit(name, ...args)
        if (this.waitingFor[name] !== undefined) {
            for (let i in this.waitingFor[name]) {
                var item = this.waitingFor[name][i]
                if (item === undefined) {
                    continue
                }
                if (item.check(...args)) {
                    delete this.waitingFor[name][i]
                    item.cb(...args)
                }
            }
        }
    }
    waitFor(event, cb, check) {
        if (this.waitingFor[event] === undefined) {
            this.waitingFor[event] = []
        }
        this.waitingFor[event].push({
            cb,
            check
        })
    }
    get username() {
        return this.__username
    }
    set username(value) {
        this.__username = value
        this.socket.emit("user joined", {"username": this.username, "color": this.color})
    }
    get color() {
        return this.__color
    }
    set color(value) {
        this.__color = value
        this.socket.emit("user joined", {"username": this.username, "color": this.color})
    }
    afk() {
        this.socket.emit("afk")
    }
    room(roomname) {
        this.socket.emit("change room", roomname)
    }
    exitroom() {
        this.socket.emit("change room", "atrium")
    }
    send(message) {
        if (this.settings.spamBypass) {
            message+=this.spamCh[this.spamIn]
            this.spamIn+=1
            if (this.spamIn === 2) {
                this.spamIn = 0
            }
        }
        if (this.settings.autoLine) {
            /*var lines = message.split('\n')
            let i = 0;
            function p() {
                if (lines[i] === undefined) {
                    return
                }
                this.socket.send(lines[i])

                i+=1
                setTimeout(p, 1000)
            }

            p()*/
            this.socket.send(message)
        } else {
            this.socket.send(message)
        }
    }
    starttyping() {
        this.socket.emit('start typing')
    }
    endtyping() {
        this.socket.emit('stop typing')
    }
    _isBlocked(m) {
        let r = this.block_db_cb('has', m.user?.id)
        if (r){this.emit('message blocked', m)}
        return r
    }
    connect() {
        let t = this
        this.socket = io('https://chat.gingerindustries.repl.co/')
        let socket = this.socket
        
        socket.on("connect", () => {
            socket.emit("user joined", {"username": this.username, "color": this.color})
            this.emit('ready')
        })
        socket.on("connect_error", (error) => {
            throw Error(error)
        })
        socket.on("message", (data) => {
            let msg = {}
            msg.isSystem = false
            msg.isDev = false
            msg.content = data.message.htmlDecode()
            if (data["role"] == -1) {
              msg.isSystem = true
            }
            else if (data["role"] == 1) {
              msg.isDev = true
            }
            msg.role = data.role
            if (this.settings.filterJoin && (msg.isSystem && msg.content === 'Welcome to Campfire! Type /help for a list of commands.')) {
                return
            }
            msg.user = t.getUser({'id':data['id']})
            msg.isSpecial = msg.isDev || msg.isSystem

            msg.mentioned = msg.content.includes('@'+this.username)
            msg.respond = msg.reply = function (message) {
                t.send(msg.user.mention+', '+message)
            }
            msg.send = function (msg) {
                t.send(msg)
            }

            if (msg.user?.name === this.username && msg.user?.color === this.color && this.settings.spamBypass) {
                msg.content = msg.content.slice(0, -1)
            }
            /*             if (this.block_db_cb('has', msg.user?.id)) {
                console.log(msg)
                return this.emit('msgblocked', msg)
            }*/
            if (this._isBlocked(msg)) {
                return
            }

            this.emit('message', msg)
        })

        socket.on("update users", (data) => {
            let t = this;
            t.users = []
            data.forEach((v)=>{
                v.mention = '@'+v.name
                v.toString = ()=>v.name
                v.resetname = ()=>{
                    /*t.socket.emit("admin", {
                        command: "resetname",
                        target: v.
                    })*/
                }
                t.users.push(v)
            })
        })
    }
}

module.exports.Bot = class extends module.exports.Client {
    constructor(prefix, ...args) {
        super(...args)
        this.prefix = prefix
        this.commands = {}
        this.on('message', (msg)=>{
            if (msg.user?.name === this.username && msg.user?.color === this.color) {
                return
            }
            if (msg.content.startsWith(prefix)) {
                let args = msg.content.slice(prefix.length).split(' ')
                if (this.commands[args[0]] === undefined) {
                    return this.emit('bad command', msg, args[0])
                }
                this.commands[args[0]](msg, ...(args.slice(1)))
            }
        })

        let t = this
        function help(msg, cmd) {
            if (cmd === undefined) {
                let cmds = Object.keys(t.commands).join(', ')
                return msg.send(`Commands: ${cmds}. Use ${t.prefix}help command to get info about a command`)
            } else {
                if (t.commands[cmd] === undefined) {
                    return msg.send('That is not a command!')
                }
                let desc = t.commands[cmd].desc
                if (desc === '') {
                    msg.send(cmd)
                } else {
                    msg.send(`${cmd} - ${desc}`)
                }
            }
        }
        this.command('help', (msg, cmd)=>{
            help(msg, cmd)
        }, 'The help command.')
    }
    command(name, callback, desc='') {
        callback.desc = desc
        this.commands[name] = callback
    }

    _isBlocked(m) {
        let r = this.block_db_cb('has', m.user?.id)
        if (r){
            if (m.content.startsWith(this.prefix)){
                this.emit('command blocked', m)
            } else {
                this.emit('message blocked', m)
            }
        }
        return r
    }
}
function connect() {
  socket = io();

  socket.on("connect", () => {
    console.log("Connected")
    document.getElementById("connecting").style.display = "none"
    if (username == null || username == "") {
      username = socket.id.substring(0, 5)
    }
    socket.emit("user joined", {"username": username, "color": localStorage.getItem("color")})
  });
  socket.on("connect_error", (error) => {
    showMessage("~", error)
  })
  socket.on("message", (data) => {
    console.log("message", data)
    if (data["user"] == "~") {
      showMessage("~ ", data["message"], "#000000")
    }
    else if (data["role"] == 1) {
      showMessage("[" + data["user"] + "]", data["message"], data["color"])
    }
    else if (!JSON.parse(localStorage.getItem("blocked")).includes(data["id"])) {
      showMessage("<" + data["user"] + "> ", data["message"], data["color"])
    }
  })
  socket.on("update users", (data) => {
    updateUsers(data)
  })
  socket.on("typing update", (data) => {
    let typing = document.getElementById("typing")
    console.log(data.length)
    let typingUsers = []
    for (let user of data) {
      if (user[1] == room) {
        if (user[0] == "Nobody") {
          typingUsers.push("Nobody (the user)")
        }
        else {
          typingUsers.push(user[0])
        }
      }
    }
    console.log(typingUsers, room)
    switch (typingUsers.length) {
      case 0:
        typing.innerText = "Nobody is typing."
        break
      case 1:
        typing.innerText = typingUsers[0] + " is typing."
        break
      case 2:
        typing.innerText = typingUsers[0] + " and " + typingUsers[1] + " are typing."
        break
      case 3:
        typing.innerText = typingUsers[0] + ", " + typingUsers[1] + ", and " + typingUsers[2] + " are typing."
        break
      default:
        typing.innerText = typingUsers[0] + ", " + typingUsers[1] + ", and " + (typingUsers.length - 2).toString() + " others are typing."
        break
    }
  })

}