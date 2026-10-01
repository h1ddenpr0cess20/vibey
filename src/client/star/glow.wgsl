// The rim bloom: brightest at the silhouette, over a faint glow through the body.

struct Varyings { @builtin(position) position: vec4f, @location(0) vN: vec3f, @location(1) vP: vec3f };
@vertex fn vs(@location(0) position: vec3f, @location(1) normal: vec3f) -> Varyings {
  var out: Varyings;
  out.vN = normalize(object.normalMatrix * normal);
  let mv = object.modelViewMatrix * vec4f(position * 1.06, 1.0);
  out.vP = mv.xyz;
  out.position = object.projectionMatrix * mv;
  return out;
}
@fragment fn fs(in: Varyings) -> @location(0) vec4f {
  let f = 1.0 - abs(dot(normalize(in.vN), normalize(-in.vP)));
  let rim = pow(f, 1.55) * (1.0 - pow(f, 12.0));
  let body = pow(f, 0.4) * 0.16;
  let a = (rim + body) * material.uStrength;
  return vec4f(material.uColor * a * 1.15, a);
}
