const app = require("@live-change/framework").app()
const validators = require("../validation")

const { language: defaultLanguage, timezone: defaultTimezone } = require('../config/defaults.js')

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
    },
    language: {
      type: String
    },
    timezone: {
      type: String
    }
  },
  indexes: {
    byUser: {
      property: "user"
    }
  }
})

definition.view({
  name: 'currentSession',
  properties: {},
  returns: {
    type: Session
  },
  daoPath(params, { client, context }, method) {
    // return Session.path(client.sessionId)
    return ['database', 'queryObject', app.databaseName, `(${
      async (input, output, { session, tableName, defaultLanguage, defaultTimezone }) => {
        const mapper = (obj) => (obj || {
          id: session,
          language: defaultLanguage,
          timezone: defaultTimezone,
          user: null,
          roles: []
        })
        let storedObj = undefined
        await input.table(tableName).object(session).onChange(async (obj, oldObj) => {
          const mappedObj = mapper(obj)
          //output.debug("MAPPED DATA", session, "OBJ", mappedObj, "OLD OBJ", storedObj)
          await output.change(mappedObj, storedObj)
          storedObj = mappedObj
        })
      }
    })`, { session: client.sessionId, tableName: Session.tableName, defaultLanguage, defaultTimezone }]
  }
})

definition.action({
  name: "createSessionIfNotExists",
  properties: {
    session: {
      type: String,
      validation: ['nonEmpty']
    },
    language: {
      type: String
    },
    timezone: {
      type: String
    }
  },
  waitForEvents: true,
  async execute({ session, language, timezone }, { client, service }, emit) {
    if(!session) session = client.sessionId
    if(session != client.sessionId) throw new Error("Wrong session id")
    const currentSession = await Session.get(session)
    if(currentSession) return 'exists'
    console.log("CREATE SESSION!", session, "AT", (new Date()).toISOString())
    emit({
      type: "created",
      session,
      language: language || defaultLanguage,
      timezone: timezone || defaultTimezone
    })
    return 'created'
  }
})

definition.action({
  name: "setLanguageAndTimezone",
  properties: {
    language: {
      type: String
    },
    timezone: {
      type: String
    }
  },
  async execute({ language, timezone }, { client, service }, emit) {
    const currentSession = await Session.get(client.sessionId)
    if(!currentSession) throw 'notFound'
    emit({
      type: "languageAndTimezoneUpdated",
      session: client.sessionId,
      language,
      timezone
    })
    return 'ok'
  }
})

definition.action({
  name: "logout",
  properties: {
  },
  async execute({ session }, { client, service }, emit) {
    if(!session) session = client.sessionId
    if(session != client.sessionId) throw new Error("Wrong session id")
    const sessionRow = await Session.get(session)
    if(!sessionRow) throw 'notFound'
    if(!sessionRow.user) throw "loggedOut"
    emit({
      type: "loggedOut",
      session
    })
    await service.trigger({
      type: "OnLogout",
      user: sessionRow.user,
      session: client.sessionId
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
  async execute({ session, language, timezone }) {
    console.log("SESSION CREATING!", session, "AT", (new Date()).toISOString())
    await Session.create({
      id: session,
      language: language || defaultLanguage,
      timezone: timezone || defaultTimezone,
      user: null,
      roles: []
    })
    console.log("SESSION CREATED!", session, "AT", (new Date()).toISOString())
  }
})

definition.event({
  name: "languageAndTimezoneUpdated",
  properties: {
    session: {
      type: Session
    },
    language: {
      type: String
    },
    timezone: {
      type: String
    }
  },
  async execute({ session, language, timezone }) {
    await Session.update(session, [
      { op: 'reverseMerge', value: { id: session, user: null, roles: [] } },
      { op: 'merge', value: { language: language, timezone: timezone } }
    ])
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
  async execute({ session, user, roles, expire, language, timezone }) {
    console.log("SESSION UPDATE", session, { user, roles, expire, language, timezone })
    await Session.update(session, { id: session, user, roles, expire, language, timezone })
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
    //await Session.update(session, { user: null, roles: [], expire: null })
    await Session.update(session, [
      {
        op: 'reverseMerge',
        value: { id: session, language: defaultLanguage, timezone: defaultTimezone }
      },
      { op: 'merge', value: { user: null, roles: [] } }
    ])
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
      async (input, output, { table, index, user, defaults }) => {
        const prefix = `"${user}"_`
        await (await input.index(index)).range({
          gte: prefix,
          lte: prefix+"\xFF\xFF\xFF\xFF"
        }).onChange((ind, oldInd) => {
          if(ind && ind.to) {
            output.table(table).update(ind.to, [
              {
                op: 'reverseMerge',
                value: { id: ind.to, ...defaults }
              },
              { op: 'merge', value: { user: null, roles: [], expire: null } }
            ])
          }
        })
      }
    })`, {
      table: Session.tableName, index: Session.tableName + '_byUser', user,
      defaults: { language: defaultLanguage, timezone: defaultTimezone }
    })
  }
})

definition.event({
  name: "rolesUpdated",
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
        async (input, output, { table, index, user, roles, defaults }) => {
          const prefix = `"${user}"_`
          await (await input.index(index)).range({
            gte: prefix,
            lte: prefix+"\xFF\xFF\xFF\xFF"
          }).onChange((ind, oldInd) => {
            if(ind && ind.to) {
              output.table(table).update(ind.to, [
                {
                  op: 'reverseMerge',
                  value: { id: ind.to, ...defaults}
                },
                { op: 'merge', value: { roles } }
              ])
            }
          })
        }
    })`, {
      table: Session.tableName, index: Session.tableName + '_byUser', user, roles,
      defaults: { language: defaultLanguage, timezone: defaultTimezone }
    })
  }
})

module.exports = definition

async function start() {
  if(!app.dao) await require('@live-change/server').setupApp({})

  process.on('unhandledRejection', (reason, p) => {
    console.log('Unhandled Rejection at: Promise', p, 'reason:', reason)
  })

  app.processServiceDefinition(definition, [ ...app.defaultProcessors ])
  await app.updateService(definition)//, { force: true })
  const service = await app.startService(definition, { runCommands: true, handleEvents: true })

  /*require("../config/metricsWriter.js")(definition.name, () => ({

  }))*/
}

if (require.main === module) start().catch( error => { console.error(error); process.exit(1) })

