// ----- Imports & Initializations
const WebSocket = require("ws"); // import websockets
const FileSystem = require("fs"); // import filesystem
const Scheduler = require("node-schedule");
const express = require('express');
const cors = require('cors');
const { error } = require("console");
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const roomConnections = {}; // A set containing all of the client sockets for each room
const scheduleMap = {}; // maps the room name to today's schedule for that room
var weather;

var mysql = require('mysql2');

var con = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

con.connect(function(err) {
  if (err) {throw err};
  console.log("Connected to sql server!");
});

// ----- Oauth Management -----


function checkValid(userID, callback)
{
    con.query("SELECT * FROM VALID_ID WHERE ID LIKE \"" + userID + "\"", function(err, result, fields) {
        if (err) {callback(err, null); return;}
        if (result.length === 0) {callback(null,false);return;}
        else {callback(null,true);}
    });
}


// ----- File Management -----


function checkRoom(room) // check to make sure that a 'room' directory contains the needed files
{
    // make sure that all of the important files storing the Schedules, Calendar, etc. exist
    if (FileSystem.existsSync("files/" + room + "/schedules.json") === false) // create an empty dictionary of all schedules
    {
        const data = {};
        FileSystem.writeFileSync("files/" + room + "/schedules.json", JSON.stringify(data));
    }
    if (FileSystem.existsSync("files/" + room + "/defaultWeek.json") === false) // create a dictionary matching the day to the schedule
    {
        const data = {0 : null, 1 : null, 2 : null, 3 : null, 4 : null, 5 : null, 6 : null}; // Sunday - Saturday : 0 - 6
        FileSystem.writeFileSync("files/" + room + "/defaultWeek.json", JSON.stringify(data));
    }
    if (FileSystem.existsSync("files/" + room + "/calendar.json") === false) // create an empty dictionary of all dates
    {
        const data = {};
        FileSystem.writeFileSync("files/" + room + "/calendar.json", JSON.stringify(data));
    }
    if (FileSystem.existsSync("files/" + room + "/layout.json") === false) // create an empty dictionary of all dates
    {
        const data = {layoutIndex:0,layouts:[{site:{backgroundColor:"#000000"}, widgetList:[]},{site:{backgroundColor:"#000000"}, widgetList:[]},{site:{backgroundColor:"#000000"}, widgetList:[]}]};
        FileSystem.writeFileSync("files/" + room + "/layout.json", JSON.stringify(data));
    }
}

// make sure that the "files" directory exists
if (FileSystem.existsSync("files") === false) // make sure the files directory exists 
{
    FileSystem.mkdirSync("files");
}
for (const i in FileSystem.readdirSync("files")) // go through every file representing its own 'room'
{
    const room = FileSystem.readdirSync("files")[i];
    checkRoom(room);
}

function getCurrentSchedule(room, callback)
{    
    // figure out today's schedule
    /*
    schedule = [];
    con.query("SELECT Calendar.scheduleID FROM nchs_css.Calendar JOIN nchs_css.Room ON Calendar.roomID = Room.id WHERE Calendar.date = CURDATE() AND Room.name = ? LIMIT 1;", [room], function(err, result, fields) {
        if (err) {callback(err, null); return;}
        if (result.length !== 0) {
            con.query("SELECT * FROM nchs_css.Schedule WHERE scheduleID = ?;", [result[0]['scheduleID']], function(err, innerResult, fields) {
                if (err) {callback(err, null); return;}
                schedule = innerResult.map(({ name, start, end }) => ({ name, start, end }));
                callback(schedule, null);
            });
        }
    });
    
    if (schedule == []) {
        con.query("SELECT Room.id FROM nchs_css.Room WHERE Room.name = ? LIMIT 1;", [room], function(err, result, fields) {
            if (err) {callback(err, null); return;}
            
            // Get current day of the week (Monday, Tuesday, etc) and create a query select that day from the Week table
            const currentDay = new Date().toLocaleString("en-US", { weekday: "long" });
            const weekQuery = `SELECT ?? AS scheduleID FROM nchs_css.Week WHERE roomID = ?;`;
            
            con.query(weekQuery, [currentDay, roomID], function (err, result) {
                if (err) {
                    callback(err, null);
                    return;
                }
        
                if (result.length === 0 || !result[0].scheduleID) {
                    callback(null, []); // No schedule found for today
                    return;
                }
            
                const scheduleID = result[0].scheduleID;

                // Query to get the schedule details from the Schedule table
                const scheduleQuery = "SELECT name, start, end FROM nchs_css.Schedule WHERE scheduleID = ?;";

                con.query(scheduleQuery, [scheduleID], function (err, scheduleResult) {
                    if (err) {
                        callback(err, null);
                        return;
                    }

                    callback(null, scheduleResult); // Return the schedule data
                });
            });   
        });
    }
    */
    const calendar = JSON.parse(FileSystem.readFileSync("files/" + room + "/calendar.json"));
    const schedules = JSON.parse(FileSystem.readFileSync("files/" + room + "/schedules.json"));

    var dateKey;
    var scheduleKey;

    const tempDate = new Date();
    dateKey = tempDate.getMonth() * 100;
    dateKey += tempDate.getDate();

    if (calendar[dateKey]) // check special schedules first
    { 
        scheduleKey = calendar[dateKey]['schedule'];
    }
    else // check the default schedules
    {
        const defaultWeek = JSON.parse(FileSystem.readFileSync("files/" + room + "/defaultWeek.json"));
        
        scheduleKey = defaultWeek[tempDate.getDay()];
    }

    var res = schedules[scheduleKey];
    if (!res) res = [];

    callback(res);

    // if yesterday's schedule was a special one time schedule, delete it
    // get yesterday's date info
    // Not necessary after moving to database
    tempDate.setDate(tempDate.getDate() - 1);
    dateKey = tempDate.getMonth() * 100;
    dateKey += tempDate.getDate();

    if (calendar[dateKey] && calendar[dateKey]['repeating'] === false) // check if deletion is needed
    {
        delete calendar[dateKey];
        FileSystem.writeFileSync("files/" + room + "/calendar.json", JSON.stringify(calendar)); // replace the calendar file with the updated calendar
    }
}

for (const i in FileSystem.readdirSync("files")) // initialize today's schedules for each room
{
    const room = FileSystem.readdirSync("files")[i];
    getCurrentSchedule(room, (res) => {scheduleMap[room] = res;}); 
}


// ----- Weather Data Management -----


function getCurrentWeather(callback)
{
    try
    {
        const newWeatherData = {};

        fetch(`https://api.weather.gov/points/41.7676,-88.1557`) // find NCHS weather gridpoint
        .then((res) => res.json())
        .then((linkData) => {
            fetch(linkData.properties.forecastHourly)
            .then((res) => res.json())
            .then((hourlyData) => {
                if (!hourlyData.properties) {console.log("Weather error1"); return;}
                newWeatherData.isDaytime = hourlyData.properties.periods[0].isDaytime;
                newWeatherData.temperature = hourlyData.properties.periods[0].temperature;
                newWeatherData.shortForecast = hourlyData.properties.periods[0].shortForecast;
                newWeatherData.relativeHumidityValue = hourlyData.properties.periods[0].relativeHumidity.value;
                fetch(linkData.properties.forecastGridData)
                .then((res) => res.json())
                .then((gridData) => {
                    if (!gridData.properties) {console.log("Weather error2"); return;}
                    const tempDate = new Date();
                    const currentHour = tempDate.getHours();
                    const offset = -5; // Chicago time is UTC -5
                    const currentDate = tempDate.getDate();
                    for (const cloudcheck of gridData.properties.skyCover.values)
                    {
                        const checkDate = parseInt(cloudcheck.validTime.slice(8,10));
                        const checkHour = parseInt(cloudcheck.validTime.slice(11,13));
                        const checkStep = parseInt(cloudcheck.validTime.slice(cloudcheck.validTime.indexOf("PT")+2,cloudcheck.validTime.indexOf("H")));
                        if (currentHour >= checkHour + ((checkDate - currentDate) * 24) + offset && currentHour < checkHour + ((checkDate - currentDate) * 24) + offset + checkStep)
                        {
                            newWeatherData.skyCover = cloudcheck.value;
                            weather = newWeatherData; // update the weather information
                            callback; // run the callback
                            return;
                        }
                    }
                });
            });
        });
    }
    catch (error) {console.log(error);};
}

getCurrentWeather();


// ----- WebSocket Management -----


const portNum = 8000; // Change this number in order to change which port the server is listening on
const wss = new WebSocket.Server({port : portNum}); // represents the server socket

async function broadcast(room) {
    if (roomConnections[room]) {
        roomConnections[room].forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
                try {
                    updateClient(ws, room);
                } catch (err) {
                    console.error(`Error broadcasting to client: ${err}`);
                }
            }
        });
    }
}
async function updateClient(ws, room) // send information to an individual client
{
    const tempLayout = JSON.parse(FileSystem.readFileSync("files/"+room+"/layout.json")).layouts[JSON.parse(FileSystem.readFileSync("files/"+room+"/layout.json")).layoutIndex];
    ws.send(JSON.stringify({schedule:scheduleMap[room], layout:tempLayout, weather:weather}));
}

// Keep connection alive (Only set up once)
wss.on('connection', (ws) => {
    console.log('WebSocket connection established');
    ws.isAlive = true;
    
    ws.on('pong', () => ws.isAlive = true);

    const interval = setInterval(() => {
        if (!ws.isAlive) {
            clearInterval(interval); // Ensure interval stops when WebSocket is dead
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    }, 30000);

    ws.on('close', () => {
        clearInterval(interval); // Stop interval when WebSocket disconnects
    });

    let firstMessageReceived = false;
    let room = null;

    ws.on('message', (msg) => {
        if (firstMessageReceived) return;
        firstMessageReceived = true;

        try {
            room = msg.toString();
            if (!scheduleMap[room]) {
                ws.send(JSON.stringify({
                    schedule: [],
                    layout: {
                        "site": { "backgroundColor": "#ffaaaa" },
                        "widgetList": [{
                            "type": "textbox",
                            "row": 1, "col": 1, "width": 14, "height": 7,
                            "config": { "backgroundColor": "#ffffff", "textColor": "#000000", "text": "\nInvalid Room Name.\nPlease press \"ESC\" on the keyboard\nto enter a room name.\n\n(The room name should correspond with a\nroom name on the \"Room Select Page\"\nof the administrative site)\n" }
                        }]
                    },
                    weather: weather
                }));
                ws.terminate();
            } else {
                if (!roomConnections[room]) {
                    roomConnections[room] = new Set();
                }
                roomConnections[room].add(ws);
                updateClient(ws, room);
            }
        } catch (e) {
            ws.terminate();
            console.log(e);
        }
    });

    ws.on('close', () => {
        if (room && roomConnections[room]) {
            roomConnections[room].delete(ws);
            if (roomConnections[room].size === 0) {
                delete roomConnections[room];
            }
        }
    });
});

// Register error event handler ONCE (outside of `wss.on('connection')`)
wss.on('error', (err) => {
    console.error('WebSocket error:', err);
});


// ----- Scheduling -----


// every day at midnight ...
const job = Scheduler.scheduleJob("0 0 * * *", () =>
{
    for (const i in FileSystem.readdirSync("files")) // for each room ...
    {
        const room = FileSystem.readdirSync("files")[i];
        getCurrentSchedule(room, (res) => 
        {
            scheduleMap[room] = res; // reset today's schedule (it's a new day)
            broadcast(room); // broadcast the changes to any connected clients
        });
    }
});

// every 30th minute ...
const weatherJob = Scheduler.scheduleJob("30 * * * *", () =>
{
    getCurrentWeather(() => 
    {
        for (const i in FileSystem.readdirSync("files")) // update the weather for each room
        {
            const room = FileSystem.readdirSync("files")[i];
            broadcast(room);
        }
    });
});


// ----- AWS -----

/*
// return the client webpage for AWS server (courtesy of ChatGPT)   :)
app.use((req, res, next) => {
    // Check if the request path is '/'
    if (req.path === '/') {
        // Proxy the request
        return createProxyMiddleware({ 
            target: 'http://localhost:3500', // target host
            changeOrigin: true, // needed for virtual hosted sites
        })(req, res, next); // Pass control to the proxy middleware
    }
    // If the request path is not '/', let it continue to the next middleware
    next();
});
*/

// ----- HTTP  -----


const httpPortNum = 8500;

app.get("/schedules", (req, res) =>{
    try
    {
        const room = req.query.room;
        res.json(JSON.parse(FileSystem.readFileSync("files/"+room+"/schedules.json")));
    }
    catch(e) {console.log(e);}
});
app.get("/defaultWeek", (req, res) =>{
    try
    {
        const room = req.query.room;
        res.json(JSON.parse(FileSystem.readFileSync("files/"+room+"/defaultWeek.json")));
    }
    catch(e) {console.log(e);}
});
app.get("/calendar", (req, res) =>{
    try
    {
        const room = req.query.room;
        res.json(JSON.parse(FileSystem.readFileSync("files/"+room+"/calendar.json")));
    }
    catch(e) {console.log(e);}
});
app.get("/layout", (req, res) =>{
    try
    {
        const room = req.query.room;
        const index = (req.query.index === "-1") ? JSON.parse(FileSystem.readFileSync("files/"+room+"/layout.json")).layoutIndex : req.query.index;
        
        const tempLayout = JSON.parse(FileSystem.readFileSync("files/"+room+"/layout.json")).layouts[index];
        res.json({widgetList:tempLayout.widgetList, site:tempLayout.site, layoutIndex:index});
    }
    catch(e) {console.log(e);}
});
// let the 'admin' get the names of the current rooms
app.get("/rooms", (req, res) =>{    
    res.json(FileSystem.readdirSync("files"));
});


// TODO: will probably need some sort of authentication system
// TODO: verify that the files are in a valid format??? (or maybe just trust the 'admin')
// let the 'admin' send over the modified json files
app.post("/schedules", (req, res) =>{
    try
    {
        checkValid(req.body.token, (err, truth) => {
            if (err) {
                // handle error
                console.log(err);
                return;
            }
            if (truth === false) {
                res.send("SERVER: invalid userID");
                return;
            }
            else {
                const room = req.body.room;
                const data = req.body.data;

                const oldName = data.oldName;
                const newName = data.newName;
                const newSchedules = data.schedules;

                FileSystem.writeFileSync("files/"+room+"/schedules.json", JSON.stringify(newSchedules)); // update server file
                
                // update the other files if needed
                const defaultWeek = JSON.parse(FileSystem.readFileSync("files/"+room+"/defaultWeek.json"));
                const calendar = JSON.parse(FileSystem.readFileSync("files/"+room+"/calendar.json"));

                for (let i = 0; i < 7; i++)
                {
                    if (defaultWeek[i] !== null)
                    {
                        if (defaultWeek[i] === oldName) defaultWeek[i] = newName;
                        if (newSchedules[defaultWeek[i]] === undefined) defaultWeek[i] = null;
                    }
                }
                for (const key in calendar)
                {
                    if (calendar[key].schedule !== null)
                    {
                        if (calendar[key].schedule === oldName) calendar[key].schedule = newName;
                        if (newSchedules[calendar[key].schedule] === undefined) delete calendar[key];
                    }
                }
                
                FileSystem.writeFileSync("files/"+room+"/defaultWeek.json", JSON.stringify(defaultWeek));
                FileSystem.writeFileSync("files/"+room+"/calendar.json", JSON.stringify(calendar));

                // send update to all clients
                getCurrentSchedule(room, (res) => {scheduleMap[room] = res; broadcast(room);}); 

                res.send("SERVER: schedule confirmation"); // send confirmation to 'admin';
            }
        });
    }
    catch (e) {console.log(e);}
});
app.post("/defaultWeek", (req, res) =>{
    try
    {
        checkValid(req.body.token, (err, truth) => {
            if (err) {
                // handle error
                console.log(err);
                return;
            }
            if (truth === false) {
                res.send("SERVER: invalid userID");
                return;
            }
            else {
                const room = req.body.room;
                const data = req.body.data;

                FileSystem.writeFileSync("files/"+room+"/defaultWeek.json", JSON.stringify(data));

                getCurrentSchedule(room, (res) => {scheduleMap[room] = res; broadcast(room);}); 

                res.send("SERVER: defaultWeek confirmation");
            }
        });
    }
    catch (e) {console.log(e);}
});
app.post("/calendar", (req, res) =>{
    try
    {
        checkValid(req.body.token, (err, truth) => {
            if (err) {
                // handle error
                console.log(err);
                return;
            }
            if (truth === false) {
                res.send("SERVER: invalid userID");
                return;
            }
            else {
                const room = req.body.room;
                const data = req.body.data;

                FileSystem.writeFileSync("files/"+room+"/calendar.json", JSON.stringify(data));

                getCurrentSchedule(room, (res) => {scheduleMap[room] = res; broadcast(room);}); 

                res.send("SERVER: calendar confirmation");
            }
        });
    }
    catch (e) {console.log(e);}
});
app.post("/layout", (req, res) =>{
    try
    {
        checkValid(req.body.token, (err, truth) => {
            if (err) {
                // handle error
                console.log(err);
                return;
            }
            if (truth === false) {
                res.send("SERVER: invalid userID");
                return;
            }
            else {
                const room = req.body.room;
                const data = req.body.data;
                
                const tempLayoutData = JSON.parse(FileSystem.readFileSync("files/"+room+"/layout.json"));
                tempLayoutData.layouts[data.layoutIndex] = {site:data.site, widgetList:data.widgetList};
                tempLayoutData.layoutIndex = data.layoutIndex;
                FileSystem.writeFileSync("files/"+room+"/layout.json", JSON.stringify(tempLayoutData));

                broadcast(room);

                res.send("SERVER: layout confirmation");
            }
        });
    }
    catch (e) {console.log(e);}
});
// modify the current 'room' folders
app.post("/rooms", (req, res) =>{
    try
    {
        checkValid(req.body.token, (err, truth) => {
            if (err) {
                // handle error
                console.log(err);
                return;
            }
            if (truth === false) {
                res.send("SERVER: invalid userID");
                return;
            }
            else {
                const oldRoom = req.body.data.old;
                const newRoom = req.body.data.new;

                if (oldRoom === null) // create a new room
                {
                    FileSystem.mkdirSync("files/" + newRoom);
                    checkRoom(newRoom);
                    scheduleMap[newRoom] = [];
                }
                else if (newRoom === null) // delete an old room
                {
                    console.log("Attempting to delete a room...");
                    FileSystem.rmSync("files/" + oldRoom, {recursive: true, force: true});
                    delete scheduleMap[oldRoom];
                    for (ws in roomConnections[oldRoom])
                    {
                        ws.terminate();
                    }
                    delete roomConnections[oldRoom];
                }
                else // rename a room
                {
                    FileSystem.renameSync("files/" + oldRoom, "files/" + newRoom);
                    delete scheduleMap[oldRoom];
                    for (ws in roomConnections[oldRoom])
                    {
                        ws.terminate();
                    }
                    delete roomConnections[oldRoom];
                    scheduleMap[newRoom] = [];
                }

                res.send("SERVER: rooms confirmation");
            }
        });
    }
    catch (e) {console.log(e);}
});

app.listen(httpPortNum);