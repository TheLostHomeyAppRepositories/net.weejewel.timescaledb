export default {
  getConfigURI: async ({ homey }) => {
    return homey.app.getConfigURI();
  },
  setConfigURI: async ({ homey, body }) => {
    const { uri } = body;
    return homey.app.setConfigURI(uri);
  },
};