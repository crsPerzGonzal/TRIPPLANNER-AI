import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserAttribute,
  CognitoUserPool,
} from 'amazon-cognito-identity-js'

const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID
const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID

let userPool
let userStorage

export function isCognitoConfigured() {
  return Boolean(userPoolId && clientId)
}

function getUserPool() {
  if (!isCognitoConfigured()) {
    throw new Error('Configura VITE_COGNITO_USER_POOL_ID y VITE_COGNITO_CLIENT_ID en frontend/.env.local.')
  }

  if (!userPool) {
    userPool = new CognitoUserPool({
      UserPoolId: userPoolId,
      ClientId: clientId,
      Storage: getUserStorage(),
    })
  }

  return userPool
}

function getUserStorage() {
  if (!userStorage) userStorage = window.sessionStorage
  return userStorage
}

function createCognitoUser(email) {
  return new CognitoUser({
    Username: email.trim(),
    Pool: getUserPool(),
    Storage: getUserStorage(),
  })
}

function getAuthenticatedUser(email, session) {
  return {
    email,
    idToken: session.getIdToken().getJwtToken(),
    accessToken: session.getAccessToken().getJwtToken(),
  }
}

function getUserSession(user) {
  return new Promise((resolve, reject) => {
    user.getSession((error, session) => {
      if (error) {
        reject(error)
        return
      }

      resolve(session)
    })
  })
}

export async function restoreSession() {
  const currentUser = getUserPool().getCurrentUser()
  if (!currentUser) return null

  const session = await getUserSession(currentUser)
  if (!session.isValid()) {
    currentUser.signOut()
    return null
  }

  return getAuthenticatedUser(currentUser.getUsername(), session)
}

export function signIn(email, password) {
  const normalizedEmail = email.trim()
  const user = createCognitoUser(normalizedEmail)
  const authenticationDetails = new AuthenticationDetails({
    Username: normalizedEmail,
    Password: password,
  })

  return new Promise((resolve, reject) => {
    user.authenticateUser(authenticationDetails, {
      onSuccess: (session) => resolve(getAuthenticatedUser(normalizedEmail, session)),
      onFailure: reject,
    })
  })
}

export function signUp(email, password) {
  const normalizedEmail = email.trim()
  const attributes = [
    new CognitoUserAttribute({ Name: 'email', Value: normalizedEmail }),
  ]

  return new Promise((resolve, reject) => {
    getUserPool().signUp(normalizedEmail, password, attributes, [], (error, result) => {
      if (error) {
        reject(error)
        return
      }

      resolve(result)
    })
  })
}

export function confirmSignUp(email, code) {
  const user = createCognitoUser(email)

  return new Promise((resolve, reject) => {
    user.confirmRegistration(code.trim(), false, (error, result) => {
      if (error) {
        reject(error)
        return
      }

      resolve(result)
    })
  })
}

export function resendConfirmationCode(email) {
  const user = createCognitoUser(email)

  return new Promise((resolve, reject) => {
    user.resendConfirmationCode((error, result) => {
      if (error) {
        reject(error)
        return
      }

      resolve(result)
    })
  })
}

export function signOut() {
  getUserPool().getCurrentUser()?.signOut()
}
