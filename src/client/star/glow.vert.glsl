// The rim bloom: brightest at the silhouette, over a faint glow through the body.

varying vec3 vN; varying vec3 vP;
void main() {
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position * 1.06, 1.0);
  vP = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
