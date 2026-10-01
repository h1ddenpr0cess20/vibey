// The rim bloom: brightest at the silhouette, over a faint glow through the body.

uniform vec3 uColor; uniform float uStrength;
varying vec3 vN; varying vec3 vP;
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(-vP)));
  float rim = pow(f, 1.55) * (1.0 - pow(f, 12.0));
  float body = pow(f, 0.4) * 0.16;
  float a = (rim + body) * uStrength;
  gl_FragColor = vec4(uColor * a * 1.15, a);
}
