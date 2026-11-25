export function createProfileController({ profileService }) {
  return Object.freeze({
    async get(req, res) {
      const profile = await profileService.getProfile(req.auth.user.id);
      return res.status(200).json({ profile });
    },

    async update(req, res) {
      const profile = await profileService.updateProfile(req.auth.user.id, req.validatedBody);
      return res.status(200).json({ profile });
    },
  });
}
