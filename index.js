const r = require.main.rethinkdb || require('rethinkdb')
if (require.main === module) require.main.rethinkdb = r

const crypto = require('crypto')
const evs = require('rethink-event-sourcing')({
  serviceName: 'session'
})

evs.onStart(
  () => {
    r.tableCreate('session')
        .run(evs.db)
        .then(ok=> console.log("TABLE session CREATED"))
        .catch(err => "ok")
  }
)

evs.registerCommands({
  createSessionIfNotExists({ session }, emit) {
    return r.table("session").get(session).run(evs.db).then(sessionRow => {
      if(sessionRow) return "exists"
      emit([{
        type: "created",
        session
      }])
      return "created"
    })
  },
  logout({ session }, emit) {
    return r.table("session").get(session).run(evs.db).then(sessionRow => {
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
    return r.table("session").insert({
      id: session
    }, { conflict: "update" }).run(evs.db)
  },

  loggedIn({ session, user, roles, expire }) {
    return r.table("session").insert({
      id: session,
      user,
      roles,
      expire
    }, { conflict: "update" }).run(evs.db)
  },

  loggedOut({ session }) {
    return r.table('session').get(session).replace(r.row.without('user','roles','expire')).run(evs.db)
  },

  userRemoved({ user }) {
    return r.table("session").filter({ user }).replace(r.row.without('user','roles','expire')).run(evs.db)
  },

  userRolesUpdated({ user, roles }) {
    return r.table("session").filter({ user }).update({
      roles
    }).run(evs.db)
  }

})


process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason)
});
