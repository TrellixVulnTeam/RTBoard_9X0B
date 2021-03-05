const SocketIO = require('socket.io');
const read_db = require('../database/read_db');
const redis = require('../database/redis');

//realtime comment socket io section
module.exports = (server) => {
  const io = SocketIO(server, {
    path: '/socket.io',
    cors: {
      origin:"*",
      method: ["GET","POST"]
    }
  });
  io.on('connection', async (socket) => {
    const req = socket.request;
    //let session = await get_session(req.headers.cookie);
    let sedata = await redis.get_session_data(socket.handshake.query.session_id);  //get session data from redis
    //let sedata = JSON.parse(session.session); //sessiondata
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    console.log('new client connect', ip, socket.id, req.ip);

    //to get all events
    var onevent = socket.onevent;
    socket.onevent = function(packet) {
      var args = packet.data || [];
      onevent.call(this, packet); // original call
      packet.data = ["*"].concat(args);
      onevent.call(this, packet); // additional call to catch-all
    };

    socket.on('disconnect', () => {
      console.log('client disconnect', ip, socket.id);
      clearInterval(socket.interval);
    });
    socket.on('error', (error) => {
      console.error(error);
    });

    socket.on("*",async (event, data) => {
      if(sedata.login) {
        data.id = sedata.login.id;
        data.uid = sedata.login.uid;
      }
      else {
        //no login data. don't emit another user
        return;
      }
      console.log("socket.io coming\nevent name:",event,"\ndata name:",data);
      var evt = event.split('/');
      //check event
      if(evt[0] === "cmt"){
        if(evt[3] === "typing"){
          // 'cmt/:boardname/:postindex/typing'
          console.log("typing action emit to:",event,"\ndata is:",data);
          socket.broadcast.emit(event,data);
          socket.emit(event,data);
        }
        else if(evt[3] === "delete"){
          // 'cmt/:boardname/:postindex/delete'
          console.log("delete emit to:",event, "\ndata is:",data);
          // update to db
          read_db.delete_one_comment(evt[1],evt[2],data.cmt_index,data.uid);
          socket.broadcast.emit(event,data);
          socket.emit(event,data);
        }
        else if(evt[3] === "write"){
          //write new comment
          // 'cmt/:boardname/:postindex/write'
          try {
            //save to DB & send broadcast
            var newDate = new Date();
            var time = newDate.toFormat('YYYY-MM-DD HH24:MI:SS');
            //send data to DB server
            let cmt_num = await read_db.create_new_comment(evt[1],evt[2],data.id,data.uid,data.text,time);
            //send broadcast
            var broadcast_data = {
              cmt_id:cmt_num,
              nickname: data.id,
              comment: data.text,
              date: time
            };
            console.log("saved",", data:", broadcast_data);
            console.log("emit to",event,"\ndate:",broadcast_data);
            socket.broadcast.emit(event,broadcast_data);
            broadcast_data.mine = true;
            socket.emit(event,broadcast_data);
          } catch (e) {
            //error
            console.log("error : ", e);
            socket.broadcast.emit(event,{id:data.id,err:"write_err"});
            socket.emit("error","cmt err!");
          }
        }
        else {
          //nothing happend;
        }
      }
    });

    //socket.broadcast.emit('board_1',"test");  //broadcast

    /*socket.interval = setInterval(() => {
      socket.emit('news', 'Hello Socket.IO');
    },3000);*/
  });
};
