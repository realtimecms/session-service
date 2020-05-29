const App = require("@live-change/framework")
const validators = require("../validation")
const app = new App()

const definition = app.createServiceDefinition({
  name: "session",
  validators
})

const User = definition.foreignModel('users', 'User')

const Session = definition.model({
  name: "Session",
  properties: {
    user: {
      type: User
    },
    roles: {
      type: Array,
      of: {
        type: String
      }
    }
  }
})

definition.action({
  name: "createSessionIfNotExists",
  properties: {
    session: {
      type: String,
      validation: ['nonEmpty']
    }
  },
  async execute({ session }, { client, service }, emit) {
    const currentSession = await Session.get(session)
    if(currentSession) return 'exists'
    emit({
      type: "created",
      session
    })
    return 'created'
  }
})

definition.action({
  name: "logout",
  properties: {
    session: {
      type: String,
      validation: ['nonEmpty']
    }
  },
  async execute({ session }, { client, service }, emit) {
    if(session != client.sessionId) throw new Error("hacking attempt")
    const sessionRow = await Session.get(session)
    if(!sessionRow) throw 'notFound'
    if(!sessionRow.user) throw "loggedOut"
    emit({
      type: "loggedOut",
      session
    })
    return 'loggedOut'
  }
})

definition.trigger({
  name: "UserDeleted",
  properties: {
    user: {
      type: User,
      idOnly: true
    }
  },
  async execute({ user }, context, emit) {
    emit([{
      type: "UserDeleted",
      user
    }])
  }
})

definition.event({
  name: "created",
  properties: {
    session: {
      type: Session
    }
  },
  async execute({ session }) {
    await Session.create({ id: session, user: null, roles: [] })
  }
})

definition.event({
  name: "loggedIn",
  properties: {
    session: {
      type: Session
    },
    user: {
      type: User
    },
    roles: {
      type: Array,
      of: {
        type: String
      }
    },
    expire: {
      type: Date
    }
  },
  async execute({ session, user, roles, expire }) {
    console.log("SESSION UPDATE", session, { user, roles, expire })
    await Session.update(session, { user, roles, expire })
  }
})

definition.event({
  name: "loggedOut",
  properties: {
    session: {
      type: Session
    }
  },
  async execute({ session }) {
    await Session.update(session, { user: null, roles: [], expire: null })
  }
})

definition.event({
  name: "UserDeleted",
  properties: {
    user: {
      type: User
    }
  },
  async execute({ user }) {
    await app.dao.request(['database', 'query'], app.databaseName, `(${
        async (input, output, { table, user }) => {
        await input.table(table).onChange((obj, oldObj) => {
          if(obj && obj.user == user) {
            output.table(table).update(obj.id, [
              { op: 'merge', value: { user: null, roles: [], expire: null } }
            ])
          }
        })
      }
    })`, { table: Session.tableName, user })
  }
})

definition.event({
  name: "userRolesUpdated",
  properties: {
    user: {
      type: User
    },
    roles: {
      type: Array,
      of: {
        type: String
      }
    }
  },
  async execute({ user, roles }) {
    await app.dao.request(['database', 'query'], app.databaseName, `(${
        async (input, output, { table, user }) => {
          await input.table(table).onChange((obj, oldObj) => {
            if(obj && obj.user == user) {
              output.table(table).update(obj.id, [
                { op: 'merge', value: { roles } }
              ])
            }
          })
        }
    })`, { table: Session.tableName, user, roles })
  }
})

module.exports = definition

async function start() {
  app.processServiceDefinition(definition, [ ...app.defaultProcessors ])
  await app.updateService(definition)//, { force: true })
  const service = await app.startService(definition, { runCommands: true, handleEvents: true })

  /*require("../config/metricsWriter.js")(definition.name, () => ({

  }))*/
}

if (require.main === module) start().catch( error => { console.error(error); process.exit(1) })

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason)
})
