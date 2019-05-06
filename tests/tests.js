const test = require('blue-tape')
const r = require('rethinkdb')
const testUtils = require('rethink-event-sourcing/tape-test-utils.js')
const crypto = require('crypto')

test('Session service login, logout', t => {
  t.plan(9)

  let conn

  testUtils.connectToDatabase(t, r, (connection) => conn = connection)

  let sessionId = crypto.randomBytes(24).toString('hex')
  let userId = crypto.randomBytes(24).toString('hex')

  t.test('create user', t => {
    t.plan(2)

    testUtils.runCommand(t, r, 'user', {
      type: 'create',
      userId: userId
    }, (cId) => { }).then(
      result => {
      }
    )

    t.test('check if user exists', t=> {
      t.plan(2)
      setTimeout(()=>{
        r.table('user').get(userId).run(conn).then(
          userRow => {
            if(userRow) t.pass('user exists')
            t.equals(userRow.display, 'unknown', 'user display name unknown')
          }
        ).catch(t.fail)
      }, 150)
    })

  })


  t.test('create session', t => {
    t.plan(2)

    testUtils.runCommand(t, r, 'session', {
      type: 'createSessionIfNotExists',
      sessionId: sessionId
    }, (cId) => {})

    t.test('check if session exists', t=> {
      t.plan(1)
      setTimeout(()=>{
        r.table('session').get(sessionId).run(conn).then(
          session => {
            if(session) t.pass('session exists')
              else t.fail('session not found')
          }
        ).catch(t.fail)
      }, 250)
    })

  })

  t.test('login', t => {
    t.plan(2)

    testUtils.pushEvents(t, r, 'session', [
      {
        type: "loggedIn",
        sessionId: sessionId,
        userId: userId,
        roles: [],
        expire: null
      }
    ])

    t.test('check if logged in', t=> {
      t.plan(2)
      setTimeout(()=>{
        r.table('session').get(sessionId).run(conn).then(
          session => {
            t.equal(session.userId, userId, 'user id match')
            t.pass('logged in')
          }
        ).catch(t.fail)
      }, 150)
    })

  })

  let commandId

  t.test('logout', t => {
    t.plan(3)

    testUtils.runCommand(t, r, 'session', {
      type: 'logout',
      sessionId: sessionId
    }, (cId) => commandId = cId)

    t.test('Check if there are events generated', t => {
      t.plan(2)

      setTimeout(()=>{
        testUtils.getGeneratedEvents(r, 'session', commandId,
          (events) => {
            t.equal(events.length, 1, "generated one event")
            t.equal(events[0].type, "loggedOut", "loggedOut event found")
          })
      }, 150)

    })

    t.test('check if logged off', t=> {
      t.plan(2)
      setTimeout(()=>{
        r.table('session').get(sessionId).run(conn).then(
          session => {
            console.log("session", session)
            t.equal(session.userId, undefined, 'userId not exists')
            t.pass('logged out')
          }
        ).catch(t.fail)
      }, 150)
    })

  })

  t.test('second login', t => {
    t.plan(2)

    testUtils.pushEvents(t, r, 'session', [
      {
        type: "loggedIn",
        sessionId: sessionId,
        userId: userId,
        roles: [],
        expire: null
      }
    ])

    t.test('check if logged in', t=> {
      t.plan(2)
      setTimeout(()=>{
        r.table('session').get(sessionId).run(conn).then(
          session => {
            t.equal(session.userId, userId, 'user id match')
            t.pass('logged in')
          }
        ).catch(t.fail)
      }, 150)
    })
  })

  t.test('change user roles, check session roles', t=> {
    t.plan(3)

    testUtils.runCommand(t, r, 'user', {
      type: 'updateRoles',
      userId: userId,
      roles: ['test_object']
    }, (cId) => { }).then(
      result => {
      }
    )

    t.test('check if user roles is changed', t => {
      t.plan(1)
      setTimeout( () => {
        r.table('user').get(userId).run(conn).then(
          user => {
            t.deepEqual(user.roles, [ 'test_object' ], 'roles are updated correctly')
          }
        ).catch( t.fail )
      }, 150)
    })

    t.test('check if session roles is changed', t => {
      t.plan(1)
      setTimeout( () => {
        r.table('session').get(sessionId).run(conn).then(
          session => {
            t.deepEqual(session.roles, [ 'test_object' ], 'roles are updated correctly')
          }
        ).catch( t.fail )
      }, 300)
    })

  })

  t.test('delete user and check if session is logged out', t => {
    t.plan(2)

    testUtils.runCommand(t, r, 'user', {
      type: 'remove',
      userId: userId
    }, (cId) => { }).then(result => {})

    t.test('check if logged out', t=> {
      t.plan(2)
      setTimeout(()=>{
        r.table('session').get(sessionId).run(conn).then(
          session => {
            console.log("session", session)
            t.equal(session.userId, undefined, 'userId not exists')
            t.pass('logged out')
          }
        ).catch(t.fail)
      }, 150)
    })

  })

  t.test('close connection', t => {
    conn.close(() => {
      t.pass('closed')
      t.end()
    })
  })

})