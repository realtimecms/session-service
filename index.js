const r = require.main.rethinkdb || require('rethinkdb')
if (require.main === module) require.main.rethinkdb = r

const crypto = require('crypto')
const evs = require('rethink-event-sourcing')({
  serviceName: 'session'
})

evs.onStart(
  () => {
    evs.db.run(r.tableCreate('session'))
        .then(ok=> console.log("TABLE session CREATED"))
        .catch(err => "ok")
  }
)

evs.registerCommands({
  createSessionIfNotExists({ session }, emit) {
    return evs.db.run(r.table("session").get(session)).then(sessionRow => {
      if(sessionRow) return "exists"
      emit([{
        type: "created",
        session
      }])
      return "created"
    })
  },
  logout({ session }, emit) {
    return evs.db.run(r.table("session").get(session)).then(sessionRow => {
      if(!sessionRow) throw evs.error("notFound")
      if(!sessionRow.user) throw evs.error("loggedOut")
      emit([{
        type: "loggedOut",
        session
      }])
    })
  }
})

evs.registerEventListeners({
  queuedBy: 'session',

  created({ session }) {
    return evs.db.run(
      r.table("session").insert({
        id: session
      }, { conflict: "update" })
    )
  },

  loggedIn({ session, user, roles, expire }) {
    return evs.db.run(
        r.table("session").insert({
          id: session,
          user,
          roles,
          expire
        }, { conflict: "update" })
    )
  },

  loggedOut({ session }) {
    return evs.db.run(
        r.table('session').get(session).replace(r.row.without('user','roles','expire'))
    )
  },

  userRemoved({ user }) {
    return evs.db.run(
        r.table("session").filter({ user }).replace(r.row.without('user','roles','expire'))
    )
  },

  userRolesUpdated({ user, roles }) {
    return evs.db.run(
      r.table("session").filter({ user }).update({
        roles
      })
    )
  }

})

require("../config/metricsWriter.js")('session', () => ({

}))


process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason)
});
