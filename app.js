'use strict'
let express = require('express')
let path = require('path')
let favicon = require('serve-favicon')
let logger = require('morgan')
let cookieParser = require('cookie-parser')
let bodyParser = require('body-parser')
const r = require('rethinkdb')
var dbConnection = null

let app = express()


// MKR1000 stuffs
let httpServer = require("http").Server(app)
let io = require('socket.io')(httpServer)

httpServer.listen(3000)

let net = require('net')
let five = require('johnny-five')
let firmata = require('firmata')
let Oled = require('oled-js') // still working in progress
let pixel = require('node-pixel')

// set options to match Firmata config for wifi
// using MKR1000 with WiFi101
var options = {
  host: '192.168.1.9',
  port: 3030
}

var led, moistureSensor, tempSensor, lightSensor, oled, strip

net.connect(options, function() { //'connect' listener
  console.log('connected to server!')

  var socketClient = this

  // use the socketClient instead of a serial port for transport
  var boardIo = new firmata.Board(socketClient)

  boardIo.once('ready', function(){
    console.log('boardIo ready')
    boardIo.isReady = true

    var board = new five.Board({io: boardIo, repl: true})

    /* RethinkDB stuffs */
    const p = r.connect({
      host: 'localhost',
      port: 28015,
      db: 'plant_monitoring_system'
    })

    dbConnection = null

    p.then(function (conn) {
      // connected to rethinkdb
      console.log('rethinkdb connected!')
      dbConnection = conn

      r.table('measurements').run(conn, function (err, cursor) {
        //cursor.each(console.log)
      })

    }).error(function (err) {
      console.log('Rethinkdb error!')
      console.log(err)
    })

    board.on('ready', function() {
      // full Johnny-Five support here
      console.log('five ready')

      // enable i2c
      this.i2cConfig()

      // setup led to correct pin
      led = new five.Led(6)

      pulseLed(led, 2000, function () {
        console.log('LED √')
      })

      // setup temperature sensor LM35
      tempSensor = new five.Thermometer({
        controller: "LM35",
        pin: "A1",
        freq: 250
      })

      // setup moisture sensor to correct pin
      moistureSensor = new five.Sensor({
        pin: 'A2',
        freq: 250
      })

      // setup light sensor to correct pin
      lightSensor = new five.Sensor({
        pin: "A3",
        freq: 250
      })

      // setup oled
      //var opts = {
      //  width: 128,
      //  height: 64,
      //  address: 0x27
      //}

      //oled = new Oled(board, five, opts)

      // setup NeoPixel strip
      strip = new pixel.Strip({
        pin: 5,
        length: 8,
        board: board,
        controller: "FIRMATA"
      })

      //strip.on("ready", function() {
      //  console.log(strip)
      //  // do stuff with the strip here.
      //  strip.color("#FF0000")
      //  strip.show()
      //  console.log(strip.pixel(1).color())
      //
      //  setInterval(function () {
      //    strip.color('#FFFFFF')
      //    strip.show()
      //
      //    console.log(strip.pixel(1).color())
      //
      //    setTimeout(function () {
      //      strip.clear()
      //      strip.off()
      //      console.log(strip.pixel(1).color())
      //    }, 5000)
      //  }, 10000)
      //})

      io.on('connection', function (socket) {
        console.log(socket.id)

        // emit usersCount on new connection
        emitUsersCount(io)

        // emit usersCount when connection is closed
        socket.on('disconnect', function () {
          emitUsersCount(io)
        })
      })

      // emit chart data on each interval
      setInterval(function () {
        emitChartData(io, tempSensor, lightSensor, moistureSensor)
        saveMeasurements(dbConnection, tempSensor, lightSensor, moistureSensor)
      }, 1000)

    })
  })

})

function emitUsersCount(io) {
  // emit usersCount to all sockets
  io.sockets.emit('usersCount', {
    totalUsers: io.engine.clientsCount
  })
}

function emitChartData(io, tempSensor, lightSensor, moistureSensor) {
  io.sockets.emit('chart:data', {
    date: new Date().getTime(),
    value: [getTemp(tempSensor), getLight(lightSensor), getMoisture(moistureSensor)]
  })
}

function saveMeasurements(connection, tempSensor, lightSensor, moistureSensor) {
  let measurement = {
    date: new Date().getTime(),
    temp: getTemp(tempSensor),
    light: getLight(lightSensor),
    moisture: getMoisture(moistureSensor)
  }

  r.table('measurements').insert(measurement).run(connection)
  .then()
  .error(function (err) {
    console.log('Error saving measurement!')
    console.log(err)
  })
}

function getTemp(tempSensor) {
  return Math.round(tempSensor.fahrenheit - 25)
}

function getLight(lightSensor) {
  return Math.round(lightSensor.value/1023*100)
}

function getMoisture(moisture) {
  return Math.round(moisture.value/1023*100)
}

function pulseLed(led, duration, cb) {
  led.blink()
  setTimeout(function () {
    led.stop().off()
    cb()
  }, duration)
}

// setting app stuff
app.locals.title = 'MKR1000'

// view engine setup
app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'jade')

// uncomment after placing your favicon in /public
app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')))
app.use(logger('dev'))
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: false }))
app.use(cookieParser())
app.use(require('node-sass-middleware')({
  src: path.join(__dirname, 'public'),
  dest: path.join(__dirname, 'public'),
  indentedSyntax: true,
  sourceMap: true
}))
app.use(express.static(path.join(__dirname, 'public')))


function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/* GET home page. */
app.get('/', function(req, res, next) {
  res.render('index')
})



function getAllTemperatureMeasurements(cb) {
  return getAllMeasurementsOfCertainType('temp', cb)
}

function getAllLightMeasurements(cb) {
  return getAllMeasurementsOfCertainType('light', cb)
}

function getAllMoistureMeasurements(cb) {
  return getAllMeasurementsOfCertainType('moisture', cb)
}

function getAllMeasurementsOfCertainType(type, cb) {
  r.table('measurements')
      .filter((m) => m.hasFields(type))
      .orderBy('date').map(function (m) {
        return [m('date'), m(type) || 0]
      })
      .run(dbConnection, function (err, measurements) {
        if (err) { return cb(err) }
        measurements.toArray(cb)
      })
}

app.get('/temperature', function (req, res, next) {
  res.render('temperature')
})

app.get('/light', function (req, res, next) {
  res.render('light')
})

app.get('/moisture', function (req, res, next) {
  res.render('moisture')
})

app.get('/api/temps', function (req, res, next) {
  getAllTemperatureMeasurements(function (err, measurements) {
    if (err) { console.log(err) }

    res.write(JSON.stringify(measurements))
    res.end()
  })
})

app.get('/api/light', function (req, res, next) {
  getAllLightMeasurements(function (err, measurements) {
    if (err) { console.log(err) }

    res.write(JSON.stringify(measurements))
    res.end()
  })
})

app.get('/api/moisture', function (req, res, next) {
  getAllMoistureMeasurements(function (err, measurements) {
    if (err) { console.log(err) }

    res.write(JSON.stringify(measurements))
    res.end()
  })
})

